// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ENS} from "@ensdomains/ens-contracts/contracts/registry/ENS.sol";
import {TextResolver} from "@ensdomains/ens-contracts/contracts/resolvers/profiles/TextResolver.sol";
import {AddrResolver} from "@ensdomains/ens-contracts/contracts/resolvers/profiles/AddrResolver.sol";
import {ContentHashResolver} from "@ensdomains/ens-contracts/contracts/resolvers/profiles/ContentHashResolver.sol";

contract PR is TextResolver, AddrResolver, ContentHashResolver {
	ENS immutable ens;
	constructor(ENS a) {
		ens = a;
	}
	function isAuthorised(bytes32 node) internal view override returns (bool) {
		return ens.owner(node) == msg.sender;
	}
	function supportsInterface( bytes4 interfaceID) public view override(TextResolver, AddrResolver, ContentHashResolver) returns (bool) {
		return super.supportsInterface(interfaceID);
	}
}
