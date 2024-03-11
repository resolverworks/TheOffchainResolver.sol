import {Foundry, Node, Resolver, to_address} from '@adraffy/blocksmith';
import {create_ccip_server, capture_stdout, print_header} from './utils.js';
import {ethers} from 'ethers';
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';

capture_stdout(new URL('./log.ansi', import.meta.url));

const TEST_NAME = 'Raffy';
const TEST_ADDR = '0x51050ec063d393217b436747617ad1c2285aeeee';

const TOR_CONTEXT = 'ccip.context';
const TOR_FALLBACK = '0xb32cdf4d3c016cb0f079f205ad61c36b1a837fb3e95c70a94bdedfca0518a010';

let foundry, root, ens, tor, xor, eth, tog, ccip, raffy_eth, onchain_eth, pr;

// offchain record handler
function resolve(name) {
	let node = root.find(name);
	if (node && node.record) return node.record;
	return {
		text(key) { return `${name}:text:${key}`; },
		addr(type) { return `0x4200000000000000000000000000000000000069`; }, 
		contenthash() { return '0xe301017012201687de19f1516b9e560ab8655faa678e3a023ebff43494ac06a36581aafc957e'; },
	};
}

before(async () => {
	print_header('Init');

	foundry = await Foundry.launch({
		port: 12345,
		chain: 1,
		log: new URL('./anvil.ansi', import.meta.url)
	});

	// deploy contracts
	root = Node.root();
	ens = await foundry.deploy({name: 'ENS'}, {
		async $set(func, node, ...args) {
			let wallet = foundry.wallet(await this.owner(node.namehash));
			return foundry.confirm(this.connect(wallet)[func](node.namehash, ...args), {name: node.name});
		},
		async $register(node, {owner, resolver = ethers.ZeroAddress} = {}) {
			let wallet = foundry.wallet(await this.owner(node.parent.namehash)); // sign from owner of parent
			owner = to_address(owner ?? wallet); // default owner is signer
			node.receipt = await foundry.confirm(this.connect(wallet).setSubnodeRecord(node.parent.namehash, node.labelhash, owner, to_address(resolver), 0), {name: node.name});
			return node;
		},
	});

	// automatic signer detection for setters that are (node, ...)
	const $resolver = {
		async $set(func, node, ...args) {
			let wallet = foundry.wallet(await ens.owner(node.namehash));
			return foundry.confirm(this.connect(wallet)[func](node.namehash, ...args), {name: node.name});
		}
	};
	pr  = await foundry.deploy({name: 'PR',  args: [to_address(ens)], wallet: 2}, $resolver); // trustless
	tor = await foundry.deploy({name: 'TOR', args: [to_address(ens)], wallet: 2}, $resolver); // trustless
	xor = await foundry.deploy({name: 'XOR', args: [to_address(ens)], wallet: 2}); // trustless

	assert(await tor.supportsInterface('0x73302a25')); // tor = tor
	assert(await xor.supportsInterface('0xc3fdc0c5')); // xor = xor
	
	// create fake ens stuff
	eth = await ens.$register(root.create('eth'));
	raffy_eth = await ens.$register(root.create('raffy.eth'), {resolver: pr, wallet: 1});
	await pr.$set('setText', raffy_eth, 'name', TEST_NAME);
	await pr.$set('setAddr(bytes32,address)', raffy_eth, TEST_ADDR);

	// setup tog
	tog = await ens.$register(eth.create('tog'), {resolver: tor});
	ccip = await create_ccip_server({
		port: foundry.info.port + 1, // derived, could be anything
		signingKey: foundry.wallet(0).signingKey, // derived, could be random
		resolver: to_address(tor),
		resolve, // we made this global so it can be used to verify responses without going through CCIP-read
		log(...a) { console.log(`[CCIP]`, ...a); },
	});
	await tor.$set('setText', tog, TOR_CONTEXT, ccip.context);

	// setup xor
	onchain_eth = await ens.$register(root.create('onchain.eth'), {resolver: xor});

	// initial registry
	await Resolver.dump(ens, root);
	print_header('Tests');
});

after(async () => {
	await new Promise(f  => setTimeout(f, 50)); // go after 
	print_header('Shutdown');
	await Resolver.dump(ens, root);
	foundry.shutdown();
	ccip.http.close();
	print_header('Results');
});

test('virtual sub', async T => {
	let node = tog.unique();
	let resolver = await Resolver.get(ens, node);
	await T.test('has name', async () => assert.equal(await resolver.text('name'), resolve(resolver.node.name).text('name')));
	await T.test('not base', async () => assert.notEqual(resolver.base, node));
});

test('onchain real sub', async T => {
	let node = await ens.$register(tog.unique());
	await tor.$set('toggleOnchain', node);
	let resolver = await Resolver.get(ens, node);
	await T.test('is onchain', async () => assert(await tor.onchain(node.namehash)));
	await T.test('has no name', async () => assert.equal(await resolver.text('name'), ''));
	await T.test('w/o ccip-read', async () => assert.equal(await resolver.text('name', {ccip: false}), ''));
	await T.test('force offchain', async () => assert.equal(await resolver.text('name', {tor: 'off'}), ''));
	await T.test('not base', async () => assert.notEqual(resolver.base, node));
});

test('onchain real sub hybrid', async T => {
	let node = await ens.$register(tog.unique(), {resolver: tor});
	let resolver = await Resolver.get(ens, node);
	await tor.$set('setText', node, 'name', TEST_NAME);
	await T.test('hybrid w/onchain', async () => assert.equal(await resolver.text('name'), TEST_NAME));
	await T.test('force onchain', async () => assert.equal(await resolver.text('name', {tor: 'on', ccip: false}), TEST_NAME));
	await T.test('force offchain', async () => assert.equal(await resolver.text('name', {tor: 'off'}), resolve(resolver.node.name).text('name')));
	await tor.$set('setText', node, 'name', ''); // clear the record
	await T.test('hybrid after clear', async () => assert.equal(await resolver.text('name'), resolve(resolver.node.name).text('name')));
});

test('hybrid fallback: node', async T => {
	// create name with fallback to raffy.eth
	let node = await ens.$register(tog.unique(), {resolver: tor});
	let resolver = await Resolver.get(ens, node);
	await tor.$set('setAddr(bytes32,uint256,bytes)', node, TOR_FALLBACK, raffy_eth.namehash);
	// resolve unset record that exists fallback
	await T.test('expect fallback', async () => assert.equal(await resolver.text('name'), TEST_NAME));
	// set an onchain record which should override fallback
	const override = 'Chonk';
	await tor.$set('setText', node, 'name', override);
	await T.test('expect overide', async () => assert.equal(await resolver.text('name'), override));
	// resolve unset record that should go offchain
	await T.test('expect offchain', async () => assert.equal(await resolver.text('chonk'), resolve(resolver.node.name).text('chonk')));
	// apply offchain filter
	await T.test('force offchain', async () => assert.equal(await resolver.text('name', {tor: 'off'}), resolve(resolver.node.name).text('name')));
});

test('onchain fallback: node', async T => {
	// create onchain name with fallback to raffy.eth
	let node = await ens.$register(tog.unique(), {resolver: tor});
	let resolver = await Resolver.get(ens, node);
	await tor.$set('toggleOnchain', node);
	await tor.$set('setAddr(bytes32,uint256,bytes)', node, TOR_FALLBACK, raffy_eth.namehash);
	// resolve unset record that exists in fallback
	await T.test('expect fallback', async () => assert.equal(await resolver.text('name'), TEST_NAME));
	// resolve unset record that exists nowhere
	await T.test('expect null', async () => assert.equal(await resolver.text('chonk'), ''));
});

test('hybrid fallback: resolver', async T => {
	// create a name with one resolver
	let node = await ens.$register(tog.unique(), {resolver: pr});
	await pr.$set('setText', node, 'name', TEST_NAME);
	let resolver0 = await Resolver.get(ens, node);
	// confirm name
	await T.test('name is set', async () => assert.equal(await resolver0.text('name'), TEST_NAME));
	// change the resolver
	await ens.$set('setResolver', node, tor);
	let resolver1 = await Resolver.get(ens, node);
	// confirm name is unset
	await T.test('name is offchain', async () => assert.equal(await resolver1.text('name'), resolve(resolver1.node.name).text('name')));
	// set alias to old resolver
	await tor.$set('setAddr(bytes32,uint256,bytes)', node, TOR_FALLBACK, to_address(pr));
	// confirm name is fallback
	await T.test('name is fallback', async () => assert.equal(await resolver1.text('name'), TEST_NAME));
});

test('fallback: underscore', async T => {
	let node = await ens.$register(tog.unique(), {resolver: tor});
	// get the resolver
	let resolver = await Resolver.get(ens, node);
	// confirm name is default
	await T.test('name is offchain', async () => assert.equal(await resolver.text('name'), resolve(resolver.node.name).text('name')));
	// create the child
	let node_ = await ens.$register(node.create('_'), {resolver: pr});
	// set a name in the child
	await pr.$set('setText', node_, 'name', TEST_NAME);
	// read the name from parent
	await T.test('name is fallback', async () => assert.equal(await resolver.text('name'), TEST_NAME));
	// disable the fallback
	await tor.$set('setAddr(bytes32,uint256,bytes)', node, TOR_FALLBACK, '0xFF');
	// read the name from parent again
	await T.test('name is fallback', async () => assert.equal(await resolver.text('name'), resolve(resolver.node.name).text('name')));
});

test('xor on tor', async T => {


});