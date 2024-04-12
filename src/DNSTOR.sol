/// @author raffy.eth
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

// interfaces
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IExtendedResolver} from "@ensdomains/ens-contracts/contracts/resolvers/profiles/IExtendedResolver.sol";
import {IExtendedDNSResolver} from "@ensdomains/ens-contracts/contracts/resolvers/profiles/IExtendedDNSResolver.sol";

// libraries
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {BytesUtils} from "@ensdomains/ens-contracts/contracts/wrapper/BytesUtils.sol";
import {HexUtils} from "@ensdomains/ens-contracts/contracts/utils/HexUtils.sol";

// https://eips.ethereum.org/EIPS/eip-3668
error OffchainLookup(address from, string[] urls, bytes request, bytes4 callback, bytes carry);

contract DNSTOR is IERC165, IExtendedDNSResolver {
	using BytesUtils for bytes;
	using HexUtils for bytes;

	error InvalidContext(bytes context); // context too short or invalid signer
	error CCIPReadExpired(uint256 t); // ccip response is stale
	error CCIPReadUntrusted(address signed, address expect);

	function supportsInterface(bytes4 x) external pure returns (bool) {
		return x == type(IERC165).interfaceId || x == type(IExtendedDNSResolver).interfaceId;
	}

	// TOR helpers
	function parseContext(bytes memory v) internal pure returns (string[] memory urls, address signer) {
		// {SIGNER} {ENDPOINT}
		// "0x51050ec063d393217B436747617aD1C2285Aeeee http://a" => (2 + 40 + 1 + 8)
		if (v.length < 51) revert InvalidContext(v);
		bool valid;
		(signer, valid) = v.hexToAddress(2, 42); // unchecked 0x-prefix
		if (!valid) revert InvalidContext(v);
		assembly {
			let size := mload(v)
			v := add(v, 43) // drop address
			mstore(v, sub(size, 43))
		}
		urls = new string[](1); // TODO: support multiple URLs
		urls[0] = string(v);
	}
	function verifyOffchain(bytes calldata ccip, bytes memory carry) internal view returns (bytes memory request, bytes memory response, bool replace) {
		bytes memory sig;
		uint64 expires;
		(response, expires, sig) = abi.decode(ccip, (bytes, uint64, bytes));
		if (expires < block.timestamp) revert CCIPReadExpired(expires);
		address signer;
		(request, signer, replace) = abi.decode(carry, (bytes, address, bool));
		bytes32 hash = keccak256(abi.encodePacked(hex"1900", address(this), expires, keccak256(request), keccak256(response)));
		address signed = ECDSA.recover(hash, sig);
		if (signed != signer) revert CCIPReadUntrusted(signed, signer);
	}

	// IExtendedDNSResolver
	function resolve(bytes calldata dnsname, bytes calldata data, bytes calldata context) external view returns (bytes memory) {
		(string[] memory urls, address signer) = parseContext(context);
		bytes memory request = abi.encodeWithSelector(IExtendedResolver.resolve.selector, dnsname, data);
		revert OffchainLookup(address(this), urls, request, this.buggedCallback.selector, abi.encode(abi.encode(request, signer, false), address(this)));
	}
	function buggedCallback(bytes calldata response, bytes calldata buggedExtraData) external view returns (bytes memory v) {
		(, v, ) = verifyOffchain(response, abi.decode(buggedExtraData, (bytes)));
	}

}
