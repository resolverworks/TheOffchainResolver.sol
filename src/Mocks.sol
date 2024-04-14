// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

// force forge to compile these
import {ENSRegistry} from "@ensdomains/ens-contracts/contracts/registry/ENSRegistry.sol";
import {Root} from "@ensdomains/ens-contracts/contracts/root/Root.sol";
import {NameWrapper} from "@ensdomains/ens-contracts/contracts/wrapper/NameWrapper.sol";
import {StaticMetadataService} from "@ensdomains/ens-contracts/contracts/wrapper/StaticMetadataService.sol";
import {PublicResolver} from "@ensdomains/ens-contracts/contracts/resolvers/PublicResolver.sol";
import {ReverseRegistrar} from "@ensdomains/ens-contracts/contracts/reverseRegistrar/ReverseRegistrar.sol";
import {BaseRegistrarImplementation} from "@ensdomains/ens-contracts/contracts/ethregistrar/BaseRegistrarImplementation.sol";
//import {StablePriceOracle} from "@ensdomains/ens-contracts/contracts/ethregistrar/StablePriceOracle.sol";
//import {DummyOracle} from "@ensdomains/ens-contracts/contracts/ethregistrar/DummyOracle.sol";
import {OffchainDNSResolver} from "@ensdomains/ens-contracts/contracts/dnsregistrar/OffchainDNSResolver.sol";
import {DNSSECImpl} from "@ensdomains/ens-contracts/contracts/dnssec-oracle/DNSSECImpl.sol";
