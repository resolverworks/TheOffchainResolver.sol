/// @author raffy.eth
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ECDSA} from "@openzeppelin/contracts@4.8.2/utils/cryptography/ECDSA.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ENS} from "@ensdomains/ens-contracts/contracts/registry/ENS.sol";
import {IExtendedResolver} from "@ensdomains/ens-contracts/contracts/resolvers/profiles/IExtendedResolver.sol";
import {IExtendedDNSResolver} from "@ensdomains/ens-contracts/contracts/resolvers/profiles/IExtendedDNSResolver.sol";
import {IAddrResolver} from "@ensdomains/ens-contracts/contracts/resolvers/profiles/IAddrResolver.sol";
import {IAddressResolver} from "@ensdomains/ens-contracts/contracts/resolvers/profiles/IAddressResolver.sol";
import {ITextResolver} from "@ensdomains/ens-contracts/contracts/resolvers/profiles/ITextResolver.sol";
import {IPubkeyResolver} from "@ensdomains/ens-contracts/contracts/resolvers/profiles/IPubkeyResolver.sol";
import {IContentHashResolver} from "@ensdomains/ens-contracts/contracts/resolvers/profiles/IContentHashResolver.sol";
import {IMulticallable} from "@ensdomains/ens-contracts/contracts/resolvers/IMulticallable.sol";
import {BytesUtils} from "@ensdomains/ens-contracts/contracts/wrapper/BytesUtils.sol";
import {HexUtils} from "@ensdomains/ens-contracts/contracts/utils/HexUtils.sol";

interface IOnchainResolver {
	function onchain(bytes32 node) external view returns (bool);
}

contract TheOffchainResolver is IERC165, ITextResolver, IAddrResolver, IAddressResolver, IPubkeyResolver, IContentHashResolver, IMulticallable, IExtendedResolver, IExtendedDNSResolver, IOnchainResolver {
	using BytesUtils for bytes;
	using HexUtils for bytes;

	error OffchainLookup(address from, string[] urls, bytes request, bytes4 callback, bytes carry);
	error Unauthorized();   // not operator of node
	error InvalidContext(); // context too short or invalid signer
	error Baseless();       // could not find self in registry
	error Expired();        // ccip response is stale
	error Untrusted();      // ccip response doesn't match signer

	ENS constant ens = ENS(0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e);

	function supportsInterface(bytes4 x) external pure returns (bool) {
		return x == type(IERC165).interfaceId
			|| x == type(ITextResolver).interfaceId
			|| x == type(IAddrResolver).interfaceId
			|| x == type(IAddressResolver).interfaceId
			|| x == type(IPubkeyResolver).interfaceId
			|| x == type(IContentHashResolver).interfaceId
			|| x == type(IMulticallable).interfaceId
			|| x == type(IExtendedResolver).interfaceId
			|| x == type(IExtendedDNSResolver).interfaceId
			|| x == type(IOnchainResolver).interfaceId
			|| x == 0x73302a25; // https://adraffy.github.io/keccak.js/test/demo.html#algo=evm&s=ccip.context&escape=1&encoding=utf8
	}

	// utils
	modifier requireOperator(bytes32 node) {
		address owner = ens.owner(node);
		if (owner != msg.sender && !ens.isApprovedForAll(owner, msg.sender)) revert Unauthorized();
		_;
	}
	function slotForCoin(bytes32 node, uint256 cty) internal pure returns (uint256) {
		return uint256(keccak256(abi.encodeWithSelector(IAddressResolver.addr.selector, node, cty)));
	}
	function slotForText(bytes32 node, string memory key) internal pure returns (uint256) {
		return uint256(keccak256(abi.encodeCall(ITextResolver.text, (node, key))));
	}
	function slotForOnchain(bytes32 node) internal pure returns (uint256) {
		return uint256(keccak256(abi.encodeCall(IOnchainResolver.onchain, (node))));
	}

	// getters
	function addr(bytes32 node) external view returns (address payable) {
		bytes memory v = getTiny(slotForCoin(node, 60));
		return payable(v.length == 20 ? address(bytes20(v)) : address(0));
	}
	function addr(bytes32 node, uint256 cty) external view returns (bytes memory) {
		return getTiny(slotForCoin(node, cty));
	}
	function text(bytes32 node, string calldata key) external view returns (string memory) {
		return string(getTiny(slotForText(node, key)));
	}
	function contenthash(bytes32 node) external view returns (bytes memory) {
		return getTiny(uint256(keccak256(abi.encodeCall(IContentHashResolver.contenthash, (node)))));
	}
	function pubkey(bytes32 node) external view returns (bytes32 x, bytes32 y) {
		return abi.decode(getTiny(uint256(keccak256(abi.encodeCall(IPubkeyResolver.pubkey, (node))))), (bytes32, bytes32));
	}
	function onchain(bytes32 node) external view returns (bool) {
		return getTiny(slotForOnchain(node)).length > 0;
	}

	// TOR helpers
	uint256 constant MIN_CONTEXT = 51;
	function ccipContext(bytes32 node) public view returns (string[] memory urls, address signer) {
		// {SIGNER} {ENDPOINT}
		// "0x51050ec063d393217B436747617aD1C2285Aeeee http://a" = 43 bytes (2 + 40 + 1 + 8)
		bytes memory v = getTiny(slotForText(node, "ccip.context"));
		if (v.length < MIN_CONTEXT) revert InvalidContext();
		bool valid;
		(signer, valid) = v.hexToAddress(2, 42); // unchecked 0x-prefix
		if (!valid) revert InvalidContext();
		assembly {
			let size := mload(v)
			v := add(v, 43) // drop address
			mstore(v, sub(size, 43))
		}
		urls = new string[](1); // TODO: support multiple URLs
		urls[0] = string(v);
	}
	function findBasename(bytes memory name) public view returns (bytes32 node, uint256 offset) {
		unchecked {
			while (true) {
				node = name.namehash(offset);
				if (ens.resolver(node) == address(this)) break;
				uint256 size = uint256(uint8(name[offset]));
				if(size == 0) revert Baseless();
				offset += 1 + size;
			}
		}
	}
	function verify(bytes calldata ccip, bytes memory carry) internal view returns (bytes memory, bytes memory) {
		(bytes memory sig, uint64 expires, bytes memory response) = abi.decode(ccip, (bytes, uint64, bytes));
		if (expires < block.timestamp) revert Expired();
		(bytes memory request, address signer) = abi.decode(carry, (bytes, address));
		bytes32 hash = keccak256(abi.encodePacked(address(this), expires, keccak256(request), keccak256(response)));
		address signed = ECDSA.recover(hash, sig);
		if (signed != signer) revert Untrusted();
		return (request, response);
	}

	// IExtendedDNSResolver
	function resolve(bytes calldata name, bytes calldata data, bytes calldata context) external view returns (bytes memory) {
		if (bytes(context).length < MIN_CONTEXT) revert InvalidContext();
		(address signer, bool valid) = context.hexToAddress(2, 42);
		if (!valid) revert InvalidContext();
		string memory endpoint = string(context[43:]);
		string[] memory urls = new string[](1);
		urls[0] = endpoint;
		bytes memory request = abi.encodeWithSelector(IExtendedResolver.resolve.selector, name, data);
		revert OffchainLookup(address(this), urls, request, this.buggedCallback.selector, abi.encode(abi.encode(request, signer), address(this)));
	}
	function buggedCallback(bytes calldata response, bytes calldata buggedExtraData) external view returns (bytes memory v) {
		(, v) = verify(response, abi.decode(buggedExtraData, (bytes)));
	}

	// IExtendedResolver
	function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory result) {
		unchecked {
			bytes memory v = getTiny(uint256(keccak256(data)));
			if (v.length > 0) return abi.encode(v);
			bytes32 node = name.namehash(0);
			if (getTiny(slotForOnchain(node)).length > 0) {
				(, v) = address(this).staticcall(data);
				return v;
			}
			if (bytes4(data) == IMulticallable.multicall.selector) {
				bytes[] memory a = abi.decode(data[4:], (bytes[]));
				bytes[] memory b = new bytes[](a.length);
				bool off;
				for (uint256 i = 0; i < a.length; i += 1) {
					v = getTiny(uint256(keccak256(a[i])));
					if (v.length == 0) {
						off = true;
						break;
					}
					b[i] = abi.encode(v);
				}
				if (!off) return abi.encode(b);
			}
			(bytes32 basenode, ) = findBasename(name); // throws
			(string[] memory urls, address signer) = ccipContext(basenode); // throws
			bytes memory request = abi.encodeWithSelector(IExtendedResolver.resolve.selector, name, data);
			revert OffchainLookup(address(this), urls, request, this.ensCallback.selector, abi.encode(request, signer));
		}
	}
	function ensCallback(bytes calldata ccip, bytes calldata carry) external view returns (bytes memory) {
		unchecked {
			(bytes memory request, bytes memory response) = verify(ccip, carry);
			assembly {
				mstore(add(request, 4), sub(mload(request), 4)) // trim resolve() selector
				request := add(request, 4)
			}
			(, bytes memory data) = abi.decode(request, (bytes, bytes));
			if (bytes4(data) == IMulticallable.multicall.selector) {
				assembly {
					mstore(add(data, 4), sub(mload(data), 4)) // trim selector
					data := add(data, 4)
				}
				bytes[] memory a = abi.decode(data, (bytes[]));
				bytes[] memory b = abi.decode(response, (bytes[]));
				require(a.length == b.length, "diff");
				for (uint256 i = 0; i < a.length; i += 1) {
					bytes memory v = getTiny(uint256(keccak256(a[i])));
					if (v.length > 0) b[i] = abi.encode(v); // replace off-chain values with on-chain if they exist
				}
				response = abi.encode(b);
			}
			return response;
		}
	}

	// multicall
	// TODO: allow ccip-read through this mechanism too
	function multicall(bytes[] calldata calls) external returns (bytes[] memory) {
		return _multicall(0, calls);
	}
	function multicallWithNodeCheck(bytes32 nodehash, bytes[] calldata calls) external returns (bytes[] memory) {
		return _multicall(nodehash, calls);
	}
	function _multicall(bytes32 node, bytes[] calldata calls) internal returns (bytes[] memory answers) {
		unchecked {
			answers = new bytes[](calls.length);
			for (uint256 i = 0; i < calls.length; i += 1) {
				require(node == 0 || bytes32(calls[i][4:36]) == node, "node");
				(bool ok, bytes memory v) = address(this).delegatecall(calls[i]);
				require(ok);
				answers[i] = v;
			}
		}
	}

	// setters
	// function setAddr(bytes32 node, address a) external {
	//     requireOperator(node);
	//     setTiny(slotForCoin(node, 60), a == address(0) ? bytes('') : abi.encodePacked(a));
	// }
	function setAddr(bytes32 node, uint256 cty, bytes calldata v) requireOperator(node) external {
		setTiny(slotForCoin(node, cty), v);
		emit AddressChanged(node, cty, v);
	}
	function setText(bytes32 node, string calldata key, string calldata s) requireOperator(node) external {
		setTiny(slotForText(node, key), bytes(s));
		emit TextChanged(node, key, key, s);
	}
	function setContenthash(bytes32 node, bytes calldata v) requireOperator(node) external {
		setTiny(uint256(keccak256(abi.encodeCall(IContentHashResolver.contenthash, (node)))), v);
		emit ContenthashChanged(node, v);
	}
	function setPubkey(bytes32 node, bytes32 x, bytes32 y) requireOperator(node)  external {
		setTiny(uint256(keccak256(abi.encodeCall(IPubkeyResolver.pubkey, (node)))), abi.encode(x, y));
		emit PubkeyChanged(node, x, y);
	}
	function toggleOnchain(bytes32 node) requireOperator(node) external {
		uint256 slot = slotForOnchain(node);
		assembly { sstore(slot, xor(sload(slot), shr(224, 1))) }
	}

	// ************************************************************
	// TinyKV.sol: https://github.com/adraffy/TinyKV.sol

	// header: first 4 bytes
	// [00000000_00000000000000000000000000000000000000000000000000000000] // null (0 slot)
	// [00000000_00000000000000000000000000000000000000000000000000000001] // empty (1 slot, hidden)
	// [00000001_XX000000000000000000000000000000000000000000000000000000] // 1 byte (1 slot)
	// [0000001C_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX] // 28 bytes (1 slot
	// [0000001D_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX][XX000000...] // 29 bytes (2 slots)
	function tinySlots(uint256 size) internal pure returns (uint256) {
		unchecked {
			return size > 0 ? (size + 35) >> 5 : 0; // ceil((4 + size) / 32)
		}
	}
	function setTiny(uint256 slot, bytes memory v) internal {
		unchecked {
			uint256 head;
			assembly { head := sload(slot) }
			uint256 size;
			assembly { size := mload(v) }
			uint256 n0 = tinySlots(head >> 224);
			uint256 n1 = tinySlots(size);
			assembly {
				// overwrite
				if gt(n1, 0) {
					sstore(slot, or(shl(224, size), shr(32, mload(add(v, 32)))))
					let ptr := add(v, 60)
					for { let i := 1 } lt(i, n1) { i := add(i, 1) } {
						sstore(add(slot, i), mload(ptr))
						ptr := add(ptr, 32)
					}
				}
				// clear unused
				for { let i := n1 } lt(i, n0) { i := add(i, 1) } {
					sstore(add(slot, i), 0)
				}
			}
		}
	}
	function getTiny(uint256 slot) internal view returns (bytes memory v) {
		unchecked {
			uint256 head;
			assembly { head := sload(slot) }
			uint256 size = head >> 224;
			if (size > 0) {
				v = new bytes(size);
				uint256 n = tinySlots(size);
				assembly {
					mstore(add(v, 32), shl(32, head))
					let p := add(v, 60)
					let i := 1
					for {} lt(i, n) {} {
						mstore(p, sload(add(slot, i)))
						p := add(p, 32)
						i := add(i, 1)
					}
				}
			}
		}
	}

}
