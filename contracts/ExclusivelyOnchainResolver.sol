/// @author raffy.eth
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ENS} from "@ensdomains/ens-contracts/contracts/registry/ENS.sol";
import {IExtendedResolver} from "@ensdomains/ens-contracts/contracts/resolvers/profiles/IExtendedResolver.sol";
import {IMulticallable} from "@ensdomains/ens-contracts/contracts/resolvers/IMulticallable.sol";
import {BytesUtils} from "@ensdomains/ens-contracts/contracts/wrapper/BytesUtils.sol";

contract ExclusivelyOnchainResolver is IERC165, IExtendedResolver {
	using BytesUtils for bytes;

	error Unreachable(bytes name); 

	address constant ENS_REGISTRY = 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e;
 
	function supportsInterface(bytes4 x) external pure returns (bool) {
		return x == type(IERC165).interfaceId 
			|| x == type(IExtendedResolver).interfaceId
			|| x == 0xc3fdc0c5; //https://adraffy.github.io/keccak.js/test/demo.html#algo=evm&s=XOR&escape=1&encoding=utf8
	}

	// IExtendedResolver
	function resolve(bytes memory name, bytes memory data) external view returns (bytes memory) {
		unchecked {
			(, uint256 offset) = findSelf(name);
			assembly { 
				mstore8(add(add(name, 32), offset), 0) // terminate
				mstore(name, add(offset, 1)) // truncate
			}
			(, address resolver, , ) = findResolver(name);
			bytes32 node = name.namehash(0);
			if (bytes4(data) == IMulticallable.multicall.selector) {
				assembly {
					mstore(add(data, 4), sub(mload(data), 4)) // trim selector
					data := add(data, 4)
				}
				bytes[] memory a = abi.decode(data, (bytes[]));
				bytes[] memory b = new bytes[](a.length);
				for (uint256 i; i < a.length; i += 1) {
					bytes memory request = a[i];
					assembly { mstore(add(request, 36), node) } // rewrite the target
					(, b[i]) = resolver.staticcall(request); // return error
				}
				return abi.encode(b);
			} else {
				assembly { mstore(add(data, 36), node) } // rewrite the target
				(bool ok, bytes memory v) = resolver.staticcall(data);
				if (!ok) assembly { revert(add(v, 32), mload(v)) } // propagate error
				return v;
			}
		}
	}

	function findSelf(bytes memory name) internal view returns (bytes32 node, uint256 offset) {
		unchecked {
			while (true) {
				node = name.namehash(offset);
				if (ENS(ENS_REGISTRY).resolver(node) == address(this)) break;
				uint256 size = uint256(uint8(name[offset]));
				if (size == 0) revert Unreachable(name);
				offset += 1 + size;
			}
		}
	}
	function findResolver(bytes memory name) internal view returns (bytes32 node, address resolver, bool wild, uint256 offset) {
		unchecked {
			while (true) {
				node = name.namehash(offset);
				resolver = ENS(ENS_REGISTRY).resolver(node);
				if (resolver != address(0)) break;
				offset += 1 + uint256(uint8(name[offset]));
			}
			try IERC165(resolver).supportsInterface(type(IExtendedResolver).interfaceId) returns (bool quacks) {
				wild = quacks;
			} catch {
			}
			if (offset != 0 && !wild) revert Unreachable(name);
		}
	}

}