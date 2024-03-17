/// @author raffy.eth
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

// https://eips.ethereum.org/EIPS/eip-3668
error OffchainLookup(address from, string[] urls, bytes request, bytes4 callback, bytes carry);

contract OffchainTunnel is IERC165 {

	error CCIPReadExpired(uint256 t);
	error CCIPReadUntrusted(address signed, address expect);
	error BadInput();
	error SelectorTaken();
	
	function supportsInterface(bytes4 x) external pure returns (bool) {
		return x == type(IERC165).interfaceId || x == this.call.selector;
	}

	function slotForContext(address a, uint256 i) internal pure returns (uint256) {
		return uint256(keccak256(abi.encodePacked(a, i)));
	}
	function slotForSelector(bytes4 x) public pure returns (uint256) {
		unchecked {
			return uint32(x) + 0x43c1d5eecd9e2f1153d9601994bca098d280c2a03f477e74cb5ae37db570bc67; // https://adraffy.github.io/keccak.js/test/demo.html
		}
	}


	function setContext(address signer, string calldata endpoint, uint96 index) public {
		setTiny(slotForContext(msg.sender, index), abi.encode(signer, endpoint));
	}
	function getContext(address owner, uint96 index) external view returns (address signer, string memory endpoint) {
		bytes memory v = getTiny(slotForContext(owner, index));
		if (v.length != 0) (signer, endpoint) = abi.decode(v, (address, string)); 
	}
	function contextForSelector(bytes4 selector) external view returns (address signer, string memory endpoint) {
		uint256 slot = slotForSelector(selector);
		uint256 cptr;
		assembly { cptr := sload(slot) }
		if (cptr != 0) {
			bytes memory v = getTiny(cptr);
			if (v.length != 0) {
				(signer, endpoint) = abi.decode(v, (address, string)); 
			}
		}
	}

	function claimAndSetContext(bytes4 selector, address signer, string calldata endpoint, uint96 index) external {		
		setContext(signer, endpoint, index);
		claim(selector, index);
	}
	function claim(bytes4 selector, uint256 index) public {
		uint256 slot = slotForSelector(selector);
		uint256 cptr;
		assembly { cptr := sload(slot) }
		if (cptr != 0) revert SelectorTaken();
		cptr = slotForContext(msg.sender, index);
		assembly { sstore(slot, cptr) }
	}

	fallback(bytes calldata req) external returns (bytes memory) {
		uint256 slot = slotForSelector(msg.sig);
		uint256 cptr;
		assembly { cptr := sload(slot) }
		if (cptr == 0) revert BadInput();
		bytes memory v = getTiny(cptr);
		if (v.length == 0) revert BadInput();
		(address signer, string memory url) = abi.decode(v, (address, string));
		call(signer, url, msg.data);
	}
	function call(address signer, string memory endpoint, bytes memory request) public view returns (bytes memory) {
		string[] memory urls = new string[](1);
		urls[0] = endpoint;
		revert OffchainLookup(address(this), urls, request, this.callback.selector, abi.encode(request, signer));
	}
	function callback(bytes calldata ccip, bytes calldata carry) external view returns (bytes memory) {
		(bytes memory sig, uint64 expires, bytes memory response) = abi.decode(ccip, (bytes, uint64, bytes));
		if (expires < block.timestamp) revert CCIPReadExpired(expires);
		(bytes memory request, address signer) = abi.decode(carry, (bytes, address));
		bytes32 hash = keccak256(abi.encodePacked(address(this), expires, keccak256(request), keccak256(response)));
		address signed = ECDSA.recover(hash, sig);
		if (signed != signer) revert CCIPReadUntrusted(signed, signer);
		assembly { return(add(response, 32), mload(response)) }
	}

	// ************************************************************
	// TinyKV.sol: https://github.com/adraffy/TinyKV.sol

	// header: first 4 bytes
	// [00000000_00000000000000000000000000000000000000000000000000000000] // null (0 slot)
	// [00000001_XX000000000000000000000000000000000000000000000000000000] // 1 byte (1 slot)
	// [0000001C_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX] // 28 bytes (1 slot
	// [0000001D_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX][XX000000...] // 29 bytes (2 slots)
	function tinySlots(uint256 size) internal pure returns (uint256) {
		unchecked {
			return size != 0 ? (size + 35) >> 5 : 0; // ceil((4 + size) / 32)
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
			if (size != 0) {
				v = new bytes(size);
				uint256 n = tinySlots(size);
				assembly {
					mstore(add(v, 32), shl(32, head))
					let p := add(v, 60)
					for { let i := 1 } lt(i, n) { i := add(i, 1) } {
						mstore(p, sload(add(slot, i)))
						p := add(p, 32)
					}
				}
			}
		}
	}
}