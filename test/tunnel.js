import {Foundry, to_address} from '@adraffy/blocksmith';
import {EZCCIP, serve} from '@resolverworks/ezccip';
import {ethers} from 'ethers';
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';

test('it works', async () => {

	let foundry = await Foundry.launch();
	after(() => foundry.shutdown());

	let abi = new ethers.Interface([
		'function f(uint256, uint256) returns (uint256)'
	]);

	let ezccip = new EZCCIP();	
	let [{frag: {selector}}] = ezccip.register(abi, ([a, b]) => [a * 1000n + b]);

	let tunnel = await foundry.deploy({file: 'OffchainTunnel'});

	let ccip = await serve(ezccip, {resolver: to_address(tunnel)});
	after(() => ccip.http.close());

	await foundry.confirm(tunnel.claimAndSetContext(selector, ccip.signer, ccip.endpoint, 0));

	console.log(await tunnel.contextForSelector(selector));

	let contract = new ethers.Contract(tunnel, abi, foundry.provider);
	assert(69420n, await contract.f.staticCall(69, 420, {enableCcipRead: true}));

});
