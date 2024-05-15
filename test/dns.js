import {Foundry, Node, Resolver, to_address} from '@adraffy/blocksmith';
import {EZCCIP, serve} from '@resolverworks/ezccip';
import {get_offchain_record, test_resolver_is_offchain} from './offchain-help.js';
import {ethers} from 'ethers';
import {test, after} from 'node:test';
import assert from 'node:assert/strict';

const LOG = false;

test('TOR', run);
test('DNSTOR', run);

function create_rrset(node, ens1) {
	const TYPE_TXT = 16;
	const CLASS_INET = 1;
	let dns = Buffer.from(node.dns);
	let txt = Buffer.from(ens1);
	let data = Buffer.alloc(1 + txt.length);
	data[0] = txt.length;
	txt.copy(data, 1);
	let buf = Buffer.alloc(dns.length + data.length + 10);
	let pos = 0;
	dns.copy(buf, pos); pos += dns.length;
	buf.writeUint16BE(TYPE_TXT, pos); pos += 2;
	buf.writeUint16BE(CLASS_INET, pos); pos += 2;
	buf.writeUint32BE(0xFFFFFFFF, pos); pos += 4;
	buf.writeUint16BE(data.length, pos); pos += 2;
	data.copy(buf, pos); pos += data.length;
	return buf.subarray(0, pos);
}

async function run(T) {

	let foundry = await Foundry.launch({infoLog: LOG});
	let root = Node.root();
	let ens = await foundry.deploy({file: 'ENSRegistry'});
	Object.assign(ens, {
		async $register(node, {owner, resolver} = {}) {
			let w = foundry.requireWallet(await this.owner(node.parent.namehash));
			owner = foundry.requireWallet(owner, w);
			await foundry.confirm(this.connect(w).setSubnodeRecord(node.parent.namehash, node.labelhash, owner, resolver ?? ethers.ZeroAddress, 0), {name: node.name});
			return node;
		}
	});
	let tor, ccip;
	switch (T.name) {
		case 'TOR': {
			tor = await foundry.deploy({file: 'TOR', args: [ens, ethers.ZeroAddress]});
			ccip = await serve(get_offchain_record, {protocol: 'tor', resolvers: {'': to_address(tor)}, log: LOG});
			break;
		}
		case 'DNSTOR': {
			tor = await foundry.deploy({file: 'DNSTORWithENSProtocol'});
			ccip = await serve(get_offchain_record, {protocol: 'ens', resolvers: {'': to_address(tor)}, log: LOG});
			break;
		}
	}
	let ens1 = `ENS1 ${to_address(tor)} ${ccip.context}`;

	after(() => {
		foundry.shutdown();
		ccip.http.close();
	});

	await T.test('direct resolve', async () => {
		let abi = new ethers.Interface([
			'function text(bytes32 node, string key) returns (string)'
		]);
		const key = 'name';
		let node = Node.create('raffy.eth');
		let answer = await tor.resolve(node.dns, abi.encodeFunctionData('text', [node.namehash, key]), Buffer.from(ccip.context), {enableCcipRead: true});
		let [value] = abi.decodeFunctionResult('text', answer);
		assert.equal(value, get_offchain_record(node.name).text(key));
	});

	await T.test('rr parse', async () => {

		// create a contract to verify that our synthetic rrset
		let checker = await foundry.deploy({sol: `
			import {RRUtils} from "@ensdomains/ens-contracts/contracts/dnssec-oracle/RRUtils.sol";
			import {BytesUtils} from "@ensdomains/ens-contracts/contracts/dnssec-oracle/BytesUtils.sol";
			contract C {
				using RRUtils for *;
				using BytesUtils for bytes;
				function parse(bytes memory rrs) external view returns (bytes memory rrname, string memory txt) {
					RRUtils.RRIterator memory iter = rrs.iterateRRs(0);
					rrname = RRUtils.readName(iter.data, iter.offset);
					uint256 len = iter.data.readUint8(iter.rdataOffset);
					txt = string(iter.data.substring(iter.rdataOffset + 1, len));
				}
			}`
		});

		// create and parse a synthetic rrset record
		let node = Node.create('raffy.xyz');
		let rrset = create_rrset(node, ens1);
		let [dns, txt] = await checker.parse(rrset);

		// verify it parsed correctly
		assert.deepEqual(ethers.getBytes(dns), node.dns);
		assert.equal(txt, ens1);
	});

	await T.test('fake oracle', async T => {

		// create an oracle that provides a fixed rrset
		let oracle = await foundry.deploy({sol: `
			import {DNSSEC} from "@ensdomains/ens-contracts/contracts/dnssec-oracle/DNSSEC.sol";
			contract FakeDNSSEC is DNSSEC {
				bytes rrset;
				function setRRSet(bytes calldata rrs) external {
					rrset = rrs;
				}
				function verifyRRSet(RRSetWithSignature[] memory input) external view override returns (bytes memory rrs, uint32 inception) {
					return verifyRRSet(input, block.timestamp);
				}
				function verifyRRSet(RRSetWithSignature[] memory, uint256) public view override returns (bytes memory rrs, uint32 inception) {
					return (rrset, 0);
				}
			}`
		});

		// create a DNSGateway that provides empty responses (since the oracle ignores it)
		let ezccip = new EZCCIP();
		ezccip.register('resolve(bytes memory name, uint16 qtype) returns (tuple(bytes, bytes)[])', () => [[]]);
		let dns_gateway = await serve(ezccip, {protocol: 'raw', log: LOG});
		after(() => dns_gateway.http.close());

		// create an OffchainDNSResolver using our fake oracle and gateway
		let dns_resolver = await foundry.deploy({import: '@ensdomains/ens-contracts/contracts/dnsregistrar/OffchainDNSResolver.sol', args: [ens, oracle, dns_gateway.endpoint]});

		// make "xyz" use the OffchainDNSResolver
		let xyz = await ens.$register(root.create('xyz'), {resolver: dns_resolver});

		// get resolver for "raffy.xyz"
		let resolver = await Resolver.get(ens, xyz.create('raffy'));

		// set the rrset for "raffy.xyz" => ENS1 using TOR
		await foundry.confirm(oracle.setRRSet(create_rrset(resolver.node, ens1)));

		// verify that it works
		await test_resolver_is_offchain(T, resolver);
	});

	// note: this requires a real text record that points to anvil deployments
	// test('real oracle', async () => {
	// 	let dns_oracle = await foundry.deploy({file: 'DNSSECImpl', args: ['0x00002b000100000e1000244a5c080249aac11d7b6f6446702e54a1607371607a1a41855200fd2ce1cdde32f24e8fb500002b000100000e1000244f660802e06d44b80b8f1d39a95c0b0d7c65d08458e880409bbc683457104237c7f8ec8d']})
	// });

}