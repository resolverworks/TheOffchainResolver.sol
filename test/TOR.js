import {Foundry, Node, Resolver, to_address} from '@adraffy/blocksmith';
import {create_ccip_server} from './ccip-server.js';
import {test, before, after} from 'node:test';
import {ethers} from 'ethers';

let foundry, root, ens, tor, eth, tog, ccip;

function getRecord(name) {
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
			node.receipt = await this.connect(wallet).setSubnodeRecord(node.parent.namehash, node.labelhash, owner, resolver, 0).then(x => x.wait());
			console.log(`${wallet.name} Register [${node.name}] => ${foundry.wallet(owner, true)?.name ?? owner}`);
			return node;
		}
	});
	tor = await foundry.deploy({name: 'TOR', args: [ens.target]});
	eth = await ens.$register(root.create('eth'));
	tog = await ens.$register(eth.create('tog'), {resolver: tor.target});

	ccip = await create_ccip_server({
		port: foundry.info.port + 1,
		signingKey: foundry.wallet(0).signingKey, // could be random
		resolver: tor.target,
		getRecord,
		log(...a) {
			console.log(`[CCIP]`, ...a);
		},
	});

	await Resolver.dump(ens, root);

	await tor.setText(tog.namehash, 'ccip.context', ccip.context).then(x => x.wait());

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

test('one virtual sub', async t => {
	let node = tog.unique();
	let resolver = await Resolver.get(ens, node);

	let profile = await resolver.profile();

	console.log(node.name, profile);
});