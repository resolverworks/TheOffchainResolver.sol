import {ethers} from 'ethers';
import assert from 'node:assert/strict';

// offchain record handler
export function get_offchain_record(name) {
	return {
		text(key) { return `${name}:text:${key}`; },
		addr(cty) { return ethers.toBeHex(cty, 20); }, 
		contenthash() { return '0xe301017012201687de19f1516b9e560ab8655faa678e3a023ebff43494ac06a36581aafc957e'; },
	};
}

// test resolver -> ccip -> offchain -> resolve() -> ccip -> resolver === resolve()
export async function test_resolver_is_offchain(T, resolver) {
	let r = get_offchain_record(resolver.node.name);
	await T.test('text', async () => assert.equal(await resolver.text('name'), r.text('name')));
	await T.test('addr', async () => assert.equal(await resolver.addr(60), r.addr(60)));
	await T.test('chash', async () => assert.equal(await resolver.contenthash(), r.contenthash()));
}
