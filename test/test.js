import {Foundry, Node, Resolver, to_address} from '@adraffy/blocksmith';
import {capture_stdout, print_header} from './utils.js';
import {get_offchain_record, test_resolver_is_offchain} from './offchain-help.js';
import {serve} from '@resolverworks/ezccip';
import {ethers} from 'ethers';
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';

capture_stdout(new URL('./log.ansi', import.meta.url));

const TEST_NAME = 'Raffy';
const TEST_ADDR = '0x51050ec063d393217b436747617ad1c2285aeeee';

const TOR_CONTEXT = 'ccip.context';
const TOR_FALLBACK = '0xb32cdf4d3c016cb0f079f205ad61c36b1a837fb3e95c70a94bdedfca0518a010';

let foundry, root, ens, ens_dao, reverse_registrar, wrapper, tor, xor, eth_nft, eth, deployer, tog_eth, ccip, raffy, raffy_eth, onchain_eth, pr;

before(async () => {
	print_header('Init');

	foundry = await Foundry.launch({
		infoLog: new URL('./anvil.ansi', import.meta.url)
	});

	// create the registry using the dao wallet
	root = Node.root();
	ens_dao = await foundry.ensureWallet('dao');
	ens = await foundry.deploy({file: 'ENSRegistry', from: ens_dao});

	// automatic registration (ETH2LD uses nft)
	Object.assign(ens, {
		async $register(node, {owner, resolver, duration = 365*24*60*60} = {}) {
			if (node.isETH2LD) {
				await foundry.confirm(eth_nft.register(node.labelhash, owner, duration), {name: node.name});
				if (resolver) await this.$set('setResolver', node, resolver);
			} else {
				let w = foundry.requireWallet(await this.owner(node.parent.namehash));
				owner = foundry.requireWallet(owner, w);
				await foundry.confirm(this.connect(w).setSubnodeRecord(node.parent.namehash, node.labelhash, owner, resolver ?? ethers.ZeroAddress, 0), {name: node.name});
			}
			return node;
		}
	});

	// automatic signer for setters that are of the form: func(node, ...)
	// $set('setResolver', node, ...) => setResolver(node.namehash, ...)
	const $setter = {
		async $set(func, node, ...args) {
			let w = foundry.requireWallet(await ens.owner(node.namehash));
			if (w === wrapper) w = foundry.requireWallet(await wrapper.ownerOf(node.namehash));
			return foundry.confirm(this.connect(w)[func](node.namehash, ...args), {name: node.name});
		}
	};
	Object.assign(ens, $setter);

	// TODO: the registry is owned by root
	//let root_controller = await foundry.deploy({file: 'Root', args: [ens], from: ens_dao});
	//await ens.$set('setOwner', root, root_controller);

	//let dummy_oracle = await foundry.deploy({file: 'DummyOracle', args: [69], from: ens_dao});
	
	// create the ETH2LD registrar
	eth = await ens.$register(root.create('eth'));
	eth_nft = await foundry.deploy({file: 'BaseRegistrarImplementation', args: [ens, eth.namehash], from: ens_dao});
	await ens.$set('setOwner', eth, eth_nft);
	await foundry.confirm(eth_nft.addController(ens_dao)); // TODO: change EOA controller to eth controller

	// create the reverse registrar
	reverse_registrar = await foundry.deploy({file: 'ReverseRegistrar', args: [ens], from: ens_dao});

	// setup the addr.reverse namespace
	let reverse = await ens.$register(root.create('reverse'));
	let addr_reverse = await ens.$register(reverse.create('addr'), {owner: reverse_registrar});

	// monitor name claims
	reverse_registrar.on('ReverseClaimed', a => addr_reverse.create(a.slice(2).toLowerCase()));

	// create the name wrapper
	let metadata_service = await foundry.deploy({file: 'StaticMetadataService', args: ['http://localhost'], from: ens_dao});
	wrapper = await foundry.deploy({file: 'NameWrapper', args: [ens, eth_nft, metadata_service]});
	Object.assign(wrapper, $setter, {
		async $wrap(node) {
			let w = foundry.requireWallet(await ens.owner(node.namehash));
			if (node.isETH2LD) {
				await foundry.confirm(eth_nft.connect(w).approve(this, node.labelhash));
				await foundry.confirm(this.connect(w).wrapETH2LD(node.label, w, 0, ethers.ZeroAddress));
			} else {
				await foundry.confirm(ens.connect(w).setApprovalForAll(this, true));
				await foundry.confirm(this.connect(w).wrap(node.dns, w, ethers.ZeroAddress));
			}
			return node;
		},
		async $unwrap(node) {
			let w = foundry.requireWallet(await this.ownerOf(node.namehash));
			if (node.isETH2LD) {
				await foundry.confirm(this.connect(w).unwrapETH2LD(node.labelhash, w, w));
			} else {
				await foundry.confirm(this.connect(w).unwrap(node.parent.namehash, node.labelhash, w));
			}
		},
	});

	// create public resolver
	pr = await foundry.deploy({file: 'PublicResolver', args: [ens, wrapper, /*controller*/ethers.ZeroAddress, reverse_registrar], from: 'deployer:pr'});
	Object.assign(pr, $setter);
	
	// create unwrapped name using PR
	raffy = await foundry.ensureWallet('raffy');
	raffy_eth = await ens.$register(eth.create('raffy'), {resolver: pr, owner: raffy});
	await pr.$set('setText', raffy_eth, 'name', TEST_NAME);
	await pr.$set('setAddr(bytes32,address)', raffy_eth, TEST_ADDR);

	// create tor
	deployer = await foundry.ensureWallet('deployer:tor');
	tor = await foundry.deploy({file: 'TOR', args: [ens, wrapper], from: deployer});
	Object.assign(tor, $setter);

	// setup tog
	tog_eth = await ens.$register(eth.create('tog'), {resolver: tor, owner: deployer});
	ccip = await serve(get_offchain_record, {resolvers: {'': to_address(tor)}});
	await tor.$set('setText', tog_eth, TOR_CONTEXT, ccip.context);

	// setup xor
	xor = await foundry.deploy({file: 'XOR', args: [ens], from: 'deployer:xor'});
	onchain_eth = await ens.$register(eth.create('onchain'), {resolver: xor, owner: ens_dao});

	// dump registry
	await Resolver.dump(ens, root);
	print_header('Tests');
});

after(async () => {
	await new Promise(f  => setTimeout(f, 50)); // go after 
	print_header('Shutdown');
	await Resolver.dump(ens, root).catch(console.log);
	foundry.shutdown();
	ccip.http.close();
	print_header('Results');
});

test('tor is tor', async () => assert(await tor.supportsInterface('0x73302a25')));
test('xor is xor', async () => assert(await xor.supportsInterface('0xc3fdc0c5')));

test('tor reverse claim', async T => {
	const name = 'tor.eth';
	let rev_node = root.find(`${to_address(tor).slice(2).toLowerCase()}.addr.reverse`);
	await T.test('exists', () => assert(rev_node != null, 'no claim'));
	await T.test('owner is deployer', async () => assert.equal(await ens.owner(rev_node.namehash), to_address(deployer)));
	await T.test('resolver is TOR', async () => assert.equal(await ens.resolver(rev_node.namehash), to_address(tor)));
	await T.test('deployer setName()', () => tor.$set('setName', rev_node, name));
	let resolver = await Resolver.get(ens, rev_node);
	await T.test('name()', async () => assert.equal(await resolver.name(), name));	
});

test('wrapped 2LD', async T => {
	let owner = await foundry.createWallet();
	let node = await ens.$register(eth.create('w2ld'), {owner, resolver: tor});
	await wrapper.$wrap(node);
	await T.test('set context', () => tor.$set('setText', node, TOR_CONTEXT, ccip.context));
	let resolver = await Resolver.get(ens, node);
	await test_resolver_is_offchain(T, resolver);
});

test('wrapped 3LD', async T => {
	let owner = await foundry.createWallet();
	let parent = await ens.$register(eth.create('w3ld'), {owner});
	let node = await ens.$register(parent.create('sub'), {resolver: tor});
	await wrapper.$wrap(node);
	let resolver = await Resolver.get(ens, node);
	await T.test('set context', () => tor.$set('setText', node, TOR_CONTEXT, ccip.context));
	await test_resolver_is_offchain(T, resolver);
});

test('virtual sub', async T => {
	let node = tog_eth.unique();
	let resolver = await Resolver.get(ens, node);
	await test_resolver_is_offchain(T, resolver);
	await T.test('not base', async () => assert.notEqual(resolver.base, node));
});

test('onchain sub', async T => {
	let node = await ens.$register(tog_eth.unique());
	await tor.$set('toggleOnchain', node);
	let resolver = await Resolver.get(ens, node);
	await T.test('is onchain', async () => assert(await tor.onchain(node.namehash)));
	await T.test('has no name', async () => assert.equal(await resolver.text('name'), ''));
	await T.test('w/o ccip-read', async () => assert.equal(await resolver.text('name', {ccip: false}), ''));
	await T.test('force offchain', async () => assert.equal(await resolver.text('name', {tor: 'off'}), ''));
	await T.test('not base', async () => assert.notEqual(resolver.base, node));
});


test('onchain sub hybrid', async T => {
	let node = await ens.$register(tog_eth.unique(), {resolver: tor});
	let resolver = await Resolver.get(ens, node);
	await tor.$set('setText', node, 'name', TEST_NAME);
	await T.test('hybrid w/onchain', async () => assert.equal(await resolver.text('name'), TEST_NAME));
	await T.test('force onchain', async () => assert.equal(await resolver.text('name', {tor: 'on', ccip: false}), TEST_NAME));
	await T.test('force offchain', async () => assert.equal(await resolver.text('name', {tor: 'off'}), get_offchain_record(resolver.node.name).text('name')));
	await tor.$set('setText', node, 'name', ''); // clear the record
	await T.test('hybrid after clear', async () => assert.equal(await resolver.text('name'), get_offchain_record(resolver.node.name).text('name')));
});

test('hybrid fallback: node', async T => {
	// create name with fallback to raffy.eth
	let node = await ens.$register(tog_eth.unique(), {resolver: tor});
	let resolver = await Resolver.get(ens, node);
	await tor.$set('setAddr(bytes32,uint256,bytes)', node, TOR_FALLBACK, raffy_eth.namehash);
	// resolve unset record that exists fallback
	await T.test('expect fallback', async () => assert.equal(await resolver.text('name'), TEST_NAME));
	// set an onchain record which should override fallback
	const override = 'Chonk';
	await tor.$set('setText', node, 'name', override);
	await T.test('expect overide', async () => assert.equal(await resolver.text('name'), override));
	// resolve unset record that should go offchain
	await T.test('expect offchain', async () => assert.equal(await resolver.text('chonk'), get_offchain_record(resolver.node.name).text('chonk')));
	// apply offchain filter
	await T.test('force offchain', async () => assert.equal(await resolver.text('name', {tor: 'off'}), get_offchain_record(resolver.node.name).text('name')));
});

test('onchain fallback: node', async T => {
	// create onchain name with fallback to raffy.eth
	let node = await ens.$register(tog_eth.unique(), {resolver: tor});
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
	let node = await ens.$register(tog_eth.unique(), {resolver: pr});
	await pr.$set('setText', node, 'name', TEST_NAME);
	let resolver0 = await Resolver.get(ens, node);
	// confirm name
	await T.test('name is set', async () => assert.equal(await resolver0.text('name'), TEST_NAME));
	// change the resolver
	await ens.$set('setResolver', node, tor);
	let resolver1 = await Resolver.get(ens, node);
	// confirm name is offchain
	await test_resolver_is_offchain(T, resolver1);
	// set alias to old resolver
	await tor.$set('setAddr(bytes32,uint256,bytes)', node, TOR_FALLBACK, to_address(pr));
	// confirm name is fallback
	await T.test('name is fallback', async () => assert.equal(await resolver1.text('name'), TEST_NAME));
});

test('fallback: underscore', async T => {
	let node = await ens.$register(tog_eth.unique(), {resolver: tor});
	// get the resolver
	let resolver = await Resolver.get(ens, node);
	// confirm name is default
	await test_resolver_is_offchain(T, resolver);
	// create the child
	let node_ = await ens.$register(node.create('_'), {resolver: pr});
	// set a name in the child
	await pr.$set('setText', node_, 'name', TEST_NAME);
	// read the name from parent
	await T.test('name is fallback', async () => assert.equal(await resolver.text('name'), TEST_NAME));
	// disable the fallback
	await tor.$set('setAddr(bytes32,uint256,bytes)', node, TOR_FALLBACK, '0xFF');
	// read the name from parent again
	await T.test('name is fallback', async () => assert.equal(await resolver.text('name'), get_offchain_record(resolver.node.name).text('name')));
});

test('xor on tor', async T => {
	let key = 'abcd';
	let node = await ens.$register(tog_eth.unique(), {resolver: tor});
	await tor.$set('setText', node, 'name', TEST_NAME);
	let resolver = await Resolver.get(ens, node);
	await T.test('name is onchain', async () => assert.equal(await resolver.text('name'), TEST_NAME));
	await T.test(`${key} is offchain`, async () => assert.equal(await resolver.text(key), get_offchain_record(node.name).text(key)));
	// try through lense
	let xor_node = onchain_eth.create(node.name);
	let xor_resolver = await Resolver.get(ens, xor_node);
	await T.test('name is still onchain', async () => assert.equal(await xor_resolver.text('name'), TEST_NAME));
	await T.test(`${key} is now empty`, async () => assert.equal(await xor_resolver.text(key), ''));
});
