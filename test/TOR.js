//import {Foundry, Node, Resolver, to_address} from '@adraffy/blocksmith';
import {Foundry, Node, Resolver, to_address} from '../../blocksmith.js/src/index.js';
import {create_ccip_server} from './ccip-server.js';
import {ethers} from 'ethers';
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';

let foundry, root, ens, tor, eth, tog, ccip, raffy, pub;

function resolve(name) {
	let node = root.find(name);
	if (node && node.record) return node.record;
	return {
		text(key) { return `text:${key}`; },
		addr(type) {
			if (type == 60) return '0x51050ec063d393217b436747617ad1c2285aeeee';
			return ethers.toBeHex(type);
		},
		pubkey() { return {x: 1, y: 2}; },
		contenthash() { return '0xe301017012201687de19f1516b9e560ab8655faa678e3a023ebff43494ac06a36581aafc957e'; },
	}
}

function header(s) {
	console.log();
	console.log(`*****[ ${s} ]`.padEnd(60, '*'));
}
function confirm(...ps) {
	return Promise.all(ps.map(p => p.then(x => x.wait())));
}

before(async () => {
	header('Init');

	foundry = await Foundry.launch({
		port: 12345,
		chain: 1,
		log: new URL('./TOR.txt', import.meta.url)
	});

	root = Node.root();
	ens = await foundry.deploy({file: '@ensdomains/ens-contracts/contracts/registry/ENSRegistry.sol'}, {
		async $register(node, {resolver, owner} = {}) {
			resolver = to_address(resolver);
			let wallet = foundry.wallet(await ens.owner(node.parent.namehash));
			owner = owner ? to_address(owner) : wallet.address;
			node.receipt = await confirm(this.connect(wallet).setSubnodeRecord(node.parent.namehash, node.labelhash, owner, resolver, 0));
			console.log(`${wallet.name} Register [${node.name}] => ${foundry.wallet(owner, true)?.name ?? owner}`);
			return node;
		}
	});
	tor = await foundry.deploy({name: 'TOR', args: [to_address(ens)]});	
	pub = await foundry.deploy({file: '@ensdomains/ens-contracts/contracts/resolvers/PublicResolver.sol'});
	eth = await ens.$register(root.create('eth'));

	// setup tog
	tog = await ens.$register(eth.create('tog'), {resolver: tor});
	ccip = await create_ccip_server({
		port: foundry.info.port + 1,
		signingKey: foundry.wallet(0).signingKey, // could be random
		resolver: to_address(tor),
		resolve,
		log(...a) {
			console.log(`[CCIP]`, ...a);
		},
	});
	await confirm(tor.setText(tog.namehash, 'ccip.context', ccip.context));

	// create raffy.eth 
	raffy = await ens.$register(root.create('raffy.eth'), {resolver: pub, owner: foundry.wallet(1)});

	await confirm()

	// initial registry
	await Resolver.dump(ens, root);
	header('Tests');
});

after(async () => {
	await new Promise(f  => setTimeout(f, 50)); // go after 
	header('Shutdown');
	await Resolver.dump(ens, root);
	foundry.shutdown();
	ccip.http.close();
	header('Results');
});

test('virtual sub', async T => {
	let node = tog.unique();
	let resolver = await Resolver.get(ens, node);
	await T.test('has name', async () => assert.equal(await resolver.text('name'), 'text:name'));
	await T.test('not base', async () => assert.notEqual(resolver.base, node));
});

test('onchain real sub', async T => {
	let node = await ens.$register(tog.unique());
	await confirm(tor.toggleOnchain(node.namehash));
	let resolver = await Resolver.get(ens, node);
	await T.test('has no name', async () => assert.equal(await resolver.text('name'), ''));
	await T.test('only onchain', async () => assert.equal(await resolver.text('name', {ccip: false}), ''));
	await T.test('is onchain', async () => assert(await tor.onchain(node.namehash)));
	await T.test('not base', async () => assert.notEqual(resolver.base, node));
});

test('onchain real sub hybrid', async T => {
	let name = 'raffy';
	let node = await ens.$register(tog.unique(), {resolver: to_address(tor)});
	let resolver = await Resolver.get(ens, node);
	await confirm(tor.setText(node.namehash, 'name', name));
	await T.test('hybrid w/onchain', async () => assert.equal(await resolver.text('name'), name));
	await T.test('offchain only', async () => assert.equal(await resolver.text('name', {tor: 'off'}), 'text:name'));
	await confirm(tor.setText(node.namehash, 'name', '')); // clear the record
	await T.test('hybrid after clear', async () => assert.equal(await resolver.text('name'), 'text:name'));
});