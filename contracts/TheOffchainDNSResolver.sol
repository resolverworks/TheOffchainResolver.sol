/// @author raffy.eth
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ECDSA} from "@openzeppelin/contracts@4.8.2/utils/cryptography/ECDSA.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ENS} from "@ensdomains/ens-contracts/contracts/registry/ENS.sol";
import {IExtendedResolver} from "@ensdomains/ens-contracts/contracts/resolvers/profiles/IExtendedResolver.sol";
import {IExtendedDNSResolver} from "@ensdomains/ens-contracts/contracts/resolvers/profiles/IExtendedDNSResolver.sol";
import {ITextResolver} from "@ensdomains/ens-contracts/contracts/resolvers/profiles/ITextResolver.sol";
import {BytesUtils} from "@ensdomains/ens-contracts/contracts/wrapper/BytesUtils.sol";

error OffchainLookup(address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData);

contract TheOffchainDNSResolver is IERC165, IExtendedDNSResolver {
	using BytesUtils for bytes;

	function supportsInterface(bytes4 x) external pure returns (bool) {
		return x == type(IERC165).interfaceId
			|| x == type(IExtendedDNSResolver).interfaceId
			|| x == 0xb3fb17f9; 
	}

	function resolve(bytes calldata name, bytes calldata data, bytes calldata context) external view returns (bytes memory) {
		require(bytes(context).length >= 51, "content");
		address signer = address(bytes20(parseHex(bytes(context)[2:42])));
		string memory endpoint = string(context[43:]);
		string[] memory urls = new string[](1);
		urls[0] = endpoint;
		bytes memory call = abi.encodeWithSelector(IExtendedResolver.resolve.selector, name, data);
		revert OffchainLookup(address(this), urls, call, this.buggedCallback.selector, abi.encode(abi.encode(call, signer), address(this)));
	}
	function resolveCallback(bytes memory response, bytes memory extraData) public view returns (bytes memory) {
		(bytes memory sig, uint64 expires, bytes memory result) = abi.decode(response, (bytes, uint64, bytes));
		require(expires > block.timestamp, "expired");
		(bytes memory call, address signer) = abi.decode(extraData, (bytes, address));
		bytes32 hash = keccak256(abi.encodePacked(address(this), expires, keccak256(call), keccak256(result)));
		address signed = ECDSA.recover(hash, sig);
		require(signed == signer, "untrusted");
		return result;
	}
	function buggedCallback(bytes calldata response, bytes calldata buggedExtraData) external view returns (bytes memory) {
		return resolveCallback(response, abi.decode(buggedExtraData, (bytes)));
	}

	function parseHex(bytes memory h) internal pure returns (bytes memory v) {
		unchecked {
			require((h.length & 1) == 0, "ragged");
			v = new bytes(h.length >> 1);
			for (uint256 i; i < h.length; i += 2) {
				uint256 u = radixFromChar(uint8(h[i]));
				uint256 l = radixFromChar(uint8(h[i + 1]));
				v[i >> 1] = bytes1(uint8((u << 4) | l));
			}
		}
	}
	function radixFromChar(uint256 ch) internal pure returns (uint256) {
		unchecked {
			if (ch >= 97 && ch <= 102) {
				return ch - 87; // [a-f] => 10-15
			} else if (ch >= 48 && ch <= 57) {
				return ch - 48; // [0-9] => 0-9
			} else if (ch >= 65 && ch <= 70) {
				return ch - 55; // [A-F] => 10-15
			} else {
				revert("bad hex");
			}
		}
	}

}
