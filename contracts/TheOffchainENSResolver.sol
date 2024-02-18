/// @author raffy.eth
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ECDSA} from "@openzeppelin/contracts@4.8.2/utils/cryptography/ECDSA.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ENS} from "@ensdomains/ens-contracts/contracts/registry/ENS.sol";
import {IExtendedResolver} from "@ensdomains/ens-contracts/contracts/resolvers/profiles/IExtendedResolver.sol";
import {IAddrResolver} from "@ensdomains/ens-contracts/contracts/resolvers/profiles/IAddrResolver.sol";
import {IAddressResolver} from "@ensdomains/ens-contracts/contracts/resolvers/profiles/IAddressResolver.sol";
import {ITextResolver} from "@ensdomains/ens-contracts/contracts/resolvers/profiles/ITextResolver.sol";
import {IPubkeyResolver} from "@ensdomains/ens-contracts/contracts/resolvers/profiles/IPubkeyResolver.sol";
import {IContentHashResolver} from "@ensdomains/ens-contracts/contracts/resolvers/profiles/IContentHashResolver.sol";
import {IMulticallable} from "@ensdomains/ens-contracts/contracts/resolvers/IMulticallable.sol";
import {BytesUtils} from "@ensdomains/ens-contracts/contracts/wrapper/BytesUtils.sol";
import {HexUtils} from "@ensdomains/ens-contracts/contracts/utils/HexUtils.sol";

error OffchainLookup(address from, string[] urls, bytes request, bytes4 callback, bytes carry);

contract TheOffchainENSResolver is IERC165, ITextResolver, IAddrResolver, IAddressResolver, IPubkeyResolver, IContentHashResolver, IExtendedResolver, IMulticallable {
	using BytesUtils for bytes;
	using HexUtils for bytes;

	address constant ENS_REGISTRY = 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e;
 
	function supportsInterface(bytes4 x) external pure returns (bool) {
		return x == type(IERC165).interfaceId
			|| x == type(ITextResolver).interfaceId
			|| x == type(IAddrResolver).interfaceId
			|| x == type(IAddressResolver).interfaceId
			|| x == type(IPubkeyResolver).interfaceId
			|| x == type(IContentHashResolver).interfaceId
			|| x == type(IExtendedResolver).interfaceId
			|| x == type(IMulticallable).interfaceId;
	}

	constructor() {
		setTiny(
			uint256(keccak256(abi.encodeCall(ITextResolver.text, (0x16a1b5518247c7f4ca69fa9ff6eb3bec6dc84d9c5ae739a29d236bca9262ad17, "ccip.context")))), 
			bytes("0xd00d726b2aD6C81E894DC6B87BE6Ce9c5572D2cd https://home.antistupid.com/ezccip/")
		);
	}

	// utils
	function requireOperator(bytes32 node) internal view {
		address owner = ENS(ENS_REGISTRY).owner(node);
		require(owner == msg.sender || ENS(ENS_REGISTRY).isApprovedForAll(owner, msg.sender), "approval");		
	}
	function slotForCoin(bytes32 node, uint256 cty) internal pure returns (uint256) {
		return uint256(keccak256(abi.encodeWithSelector(IAddressResolver.addr.selector, node, cty)));
	}

	// getters
	function addr(bytes32 node) external view returns (address payable) {
		(, bytes memory v) = getTiny(slotForCoin(node, 60));
		return payable(v.length == 20 ? address(bytes20(v)) : address(0));
	}
	function addr(bytes32, uint256) external view returns (bytes memory) { 
		return getTinyFromCall(); 
	}
	function text(bytes32, string calldata) external view returns (string memory) { 
		return string(getTinyFromCall());	
	}
	function contenthash(bytes32) external view returns (bytes memory) { 
		return getTinyFromCall(); 
	}
	function pubkey(bytes32) external view returns (bytes32 x, bytes32 y) { 
		return abi.decode(getTinyFromCall(), (bytes32, bytes32)); 
	}
	
	// TOR helpers
	uint256 constant MIN_CONTEXT = 43;
	function ccipContext(bytes32 node) public view returns (string[] memory urls, address signer, bool valid) {
		// {SIGNER} {ENDPOINT}
		// "0x51050ec063d393217B436747617aD1C2285Aeeee " = 43 bytes (2 + 40 + 1)
		(, bytes memory v) = getTiny(uint256(keccak256(abi.encodeCall(ITextResolver.text, (node, "ccip.context")))));
		if (v.length > MIN_CONTEXT) { // TODO: decide to revert
			(signer, valid) = v.hexToAddress(2, 42); // unchecked 0x-prefix
			assembly {
				let size := mload(v)
				v := add(v, MIN_CONTEXT) // drop address
				mstore(v, sub(size, MIN_CONTEXT))
			}
			urls = new string[](1); // TODO: support multiple URLs
			urls[0] = string(v);
		}
	}
	function findBasename(bytes memory name) public view returns (bytes32 node, uint256 offset) {
		unchecked {
			while (true) {
				node = name.namehash(offset);
				if (ENS(ENS_REGISTRY).resolver(node) == address(this)) break;
				uint256 size = uint256(uint8(name[offset]));
				require(size > 0, "base");
				offset += 1 + size;
			}
		}
	}

	// wildcard support
	function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory result) {
		unchecked {
			(bool empty, bytes memory v) = getTiny(uint256(keccak256(data)));
			if (v.length > 0 || empty) return abi.encode(v);
			(bytes32 node, ) = findBasename(name);
			if (bytes4(data) == IMulticallable.multicall.selector) {
				bytes[] memory a = abi.decode(data[4:], (bytes[]));
				bytes[] memory b = new bytes[](a.length);
				bool off;
				for (uint256 i = 0; i < a.length; i += 1) {
					(empty, v) = getTiny(uint256(keccak256(a[i])));
					if (v.length == 0 && !empty) {
						off = true;
						break;
					}
					b[i] = abi.encode(v);
				}
				if (!off) return abi.encode(b);
			}
			(string[] memory urls, address signer, ) = ccipContext(node);
			bytes memory request = abi.encodeWithSelector(IExtendedResolver.resolve.selector, name, data);
			revert OffchainLookup(address(this), urls, request, this.resolveCallback.selector, abi.encode(request, signer));
		}
	}
	function verify(bytes calldata ccip, bytes calldata carry) internal view returns (bytes memory, bytes memory) {
		(bytes memory sig, uint64 expires, bytes memory response) = abi.decode(ccip, (bytes, uint64, bytes));
		require(expires > block.timestamp, "expired");
		(bytes memory request, address signer) = abi.decode(carry, (bytes, address));
		bytes32 hash = keccak256(abi.encodePacked(address(this), expires, keccak256(request), keccak256(response)));
		address signed = ECDSA.recover(hash, sig);
		require(signed == signer, "untrusted");
		return (request, response);
	}
	function resolveCallback(bytes calldata ccip, bytes calldata carry) external view returns (bytes memory) {
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
					(bool empty, bytes memory v) = getTiny(uint256(keccak256(a[i])));
					if (v.length > 0 || empty) b[i] = abi.encode(v);
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
	function setText(bytes32 node, string calldata key, string calldata s) external {
		requireOperator(node);
		setTiny(uint256(keccak256(abi.encodeWithSelector(this.text.selector, node, key))), bytes(s));
		emit TextChanged(node, key, key, s);
	}
	function setAddr(bytes32 node, uint256 cty, bytes calldata v) external {
		requireOperator(node);
		setTiny(slotForCoin(node, cty), v);
		emit AddressChanged(node, cty, v);
	}
	// function setAddr(bytes32 node, address a) external {
	//     requireOperator(node);
	//     setTiny(slotForCoin(node, 60), a == address(0) ? bytes('') : abi.encodePacked(a));
	// }
	function setContenthash(bytes32 node, bytes calldata v) external {
		requireOperator(node);
		setTiny(uint256(keccak256(abi.encodeCall(this.contenthash, (node)))), v);
		emit ContenthashChanged(node, v);
	}
	function setPubkey(bytes32 node, bytes32 x, bytes32 y) external {
		requireOperator(node);
		setTiny(uint256(keccak256(abi.encodeCall(this.pubkey, (node)))), abi.encode(x, y));
		emit PubkeyChanged(node, x, y);
	}

	// on-chain null
	function toggleNull(bytes calldata request) external {
		require(request.length >= 36, "bad"); // bytes4(selector) + bytes32(node) + ...
		requireOperator(bytes32(request[4:36]));
		uint256 slot = uint256(keccak256(request));
		(bool empty, bytes memory v) = getTiny(slot);
		require(v.length == 0, "!null");
		assembly { sstore(slot, not(empty)) }
	}
	function isNull(bytes calldata request) view external returns (bool empty) {
		(empty, ) = getTiny(uint256(keccak256(request)));
	}

	// ************************************************************
	// TinyKV.sol: https://github.com/adraffy/TinyKV.sol

	// header: first 4 bytes
	// [00000000_00000000000000000000000000000000000000000000000000000000] // null (0 slot)
	// [00000000_00000000000000000000000000000000000000000000000000000001] // empty (1 slot, hidden)
	// [00000001_XX000000000000000000000000000000000000000000000000000000] // 1 byte (1 slot)
	// [0000001C_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX] // 28 bytes (1 slot
	// [0000001D_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX][XX000000...] // 29 bytes (2 slots)
	function tinySlots(uint256 size) public pure returns (uint256) {
		unchecked {
			return size > 0 ? (size + 35) >> 5 : 0;
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
	function getTiny(uint256 slot) internal view returns (bool empty, bytes memory v) {
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
			} else {
				empty = head > 0;
			}
		}
	}
	function getTinyFromCall() internal view returns (bytes memory) {
		uint256 slot;
		assembly {
			let p := mload(0x40)
			let n := calldatasize()
			calldatacopy(p, 0, n)
			slot := keccak256(p, n)
		}
		(, bytes memory v) = getTiny(slot);
		return v;
	}
	
}
