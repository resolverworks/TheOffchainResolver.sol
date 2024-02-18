//import {test} from 'node:test';
import {ethers} from 'ethers';

let provider = new ethers.InfuraProvider(5);

let contract = new ethers.Contract('0x50Bb9f68989c4b94059E774af65caA8487Bd2499', [
	'function resolve(bytes name, bytes data) external view returns (bytes)',
], provider);

let iface = new ethers.Interface([
	'function supportsInterface(bytes4 interfaceID) external view returns (bool)',
	'function interfaceImplementer(bytes32 node, bytes4 interfaceID) external view returns (address)',
	'function resolve(bytes name, bytes data) view returns (bytes)',
	'function addr(bytes32 node, uint coinType) view returns (bytes)',
	'function addr(bytes32 node) view returns (address)',
	'function text(bytes32 node, string key) view returns (string)',
	'function contenthash(bytes32 node) view returns (bytes)',
	'function pubkey(bytes32 node) view returns (bytes32 x, bytes32 y)',
	'function name(bytes32 node) view returns (string)',
	'function recordVersions(bytes32 node) external view returns (uint64)',
	'function multicall(bytes[] data) external view returns (bytes[] results)',
]);

let name = 'debug.eth';
let subname = `sub.${name}`;

console.log('single onchain',  await single('debug.eth', 'text', 'ccip.context'));
console.log('single offchain', await single('debug.eth', 'text', 'name'));

console.log('mulit onchain', await multi('debug.eth', [
	['text', 'ccip.context'],
	['text', 'ccip.context']
]));

console.log('multi offchain', await multi('debug.eth', [
	['text', 'name'],
	['text', 'description']
]));

console.log('multi hybrid', await multi('debug.eth', [
	['text', 'name'],
	['text', 'ccip.context'],
]));

async function single(name, field, ...args) {
	let node = ethers.namehash(name);
	let dns = ethers.dnsEncode(name);
	let func = iface.getFunction(field);
	let encoded = iface.encodeFunctionData(func, [node, ...args]);
	let data = await contract.resolve(dns, encoded, {enableCcipRead: true});
	return {name, node, dns, record: [field, ...args], value: decode_result(func, data)};
}

async function multi(name, records) {
	let node = ethers.namehash(name);
	let dns = ethers.dnsEncode(name);
	let calls = records.map(([type, ...a]) => {
		return iface.encodeFunctionData(iface.getFunction(type), [node, ...a]);
	});
	let func = iface.getFunction('multicall');
	let encoded = iface.encodeFunctionData(func, [calls]);
	let data = await contract.resolve(dns, encoded, {enableCcipRead: true});
	let [multi] = iface.decodeFunctionResult(func, data);
	let values = Object.fromEntries(records.map(([type, ...a], i) => {
		return [`${func.name}(${a})`, decode_result(iface.getFunction(type), multi[i])];
	}));
	return {name, records, node, dns, values};
}

function decode_result(func, data) {
	try {
		let res = [...iface.decodeFunctionResult(func, data)];
		if (func.outputs.length == 1) res = res[0];
		return res;
	} catch (err) {
		return err;
	}
}
