/// @author raffy.eth
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

library ECDSA {

	uint256 constant HALF_secp256k1n = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

	error InvalidSignature();

	function recover(bytes32 h, bytes memory sig) internal pure returns (address signer) {
		bytes32 r;
		bytes32 s;
		uint8 v;
		assembly {
			r := mload(add(sig, 0x20))
			s := mload(add(sig, 0x40))
			v := byte(0, mload(add(sig, 0x60)))
		}
		if (uint256(s) > HALF_secp256k1n) revert InvalidSignature();
		signer = ecrecover(h, v, r, s);
		if (signer == address(0)) revert InvalidSignature();
 	}

}
