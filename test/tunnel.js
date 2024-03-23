import {Foundry, to_address} from '@adraffy/blocksmith';
import {EZCCIP, serve} from '@resolverworks/ezccip';
import {ethers} from 'ethers';
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';

test('it works', async () => {

	// launch an anvil testnet
	let foundry = await Foundry.launch();
	after(() => foundry.shutdown());

	// define an interface for ccip
	let abi = new ethers.Interface([
		'function f(uint256, uint256) returns (uint256)'
	]);

	// create ccip-handler for f() define it below, in js
	let ezccip = new EZCCIP();
	// (assocate the single-function-abi with the supplied implementation)
	let [{frag: {selector}}] = ezccip.register(abi, ([a, b]) => [a * 1000n + b]); 

	// deploy trustless tunnel-contract
	let tunnel = await foundry.deploy({file: 'OffchainTunnel'});

	// create a ccip-server for answering wrappable-questions from tunnel-contract
	let ccip = await serve(ezccip, {resolver: to_address(tunnel)});
	after(() => ccip.http.close());

	// claim interface of f() on tunnel thats "tunnels" to our ccip-server
	await foundry.confirm(tunnel.claimAndSetContext(selector, ccip.signer, ccip.endpoint, 0));

	// print the owner and server info for f()
	console.log(await tunnel.getSelector(selector));

	// call f() on tunnel, which via fallback + register,y
	// reverts for ccip using our ccip-endpoint,
	// then verifies our response was signed by the registered signer,
	// last, returns the result of f()
	let contract = new ethers.Contract(tunnel, abi, foundry.provider);
	assert(69420n, await contract.f.staticCall(69, 420, {enableCcipRead: true}));

});
