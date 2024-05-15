import {ethers} from 'ethers';

let provider = new ethers.CloudflareProvider();


// [NameWrapper] https://etherscan.io/address/0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401
let contract = new ethers.Contract('0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401', [
	'function ownerOf(uint256) view returns (address)',
	'function canModifyName(bytes32, address) view returns (bool)',
], provider);

let node = ethers.namehash('dessert3.menu.bestsushi7.eth');
let owner = await contract.ownerOf(node);
console.log({node, owner});

console.log(await contract.ownerOf.estimateGas(ethers.ZeroHash));
// 23960

console.log(await contract.ownerOf.estimateGas(node));
// 24384

console.log(await contract.canModifyName.estimateGas(node, owner));
// 25033

console.log(await contract.canModifyName.estimateGas(node, '0x51050ec063d393217B436747617aD1C2285Aeeee'));
// 27235
