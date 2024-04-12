import {Foundry} from '@adraffy/blocksmith';
import {ethers} from 'ethers';
import {test, after} from 'node:test';
import assert from 'node:assert/strict';

test('ECDSA', async T => {

	let foundry = await Foundry.launch();
	after(() => foundry.shutdown());

	let contract = await foundry.deploy({sol: `
		import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
		import {ECDSA as ECDSA2} from "@src/ECDSA.sol";
		contract C {
			function openz(bytes32 h, bytes memory sig) external pure returns (address) {
				return ECDSA.recover(h, sig);
			}
			function raffy(bytes32 h, bytes memory sig) external pure returns (address) {
				return ECDSA2.recover(h, sig);
			}
			function same(bytes32 h, bytes memory sig) external pure {
				assert(ECDSA.recover(h, sig) == ECDSA2.recover(h, sig));
			}
		}
	`});

	await T.test('same', async () => {
		for (let i = 0; i < 1000; i++) {
			let key = new ethers.SigningKey(ethers.randomBytes(32));
			let hash = ethers.randomBytes(32);
			let sig = key.sign(hash).serialized;
			await contract.same(hash, sig);
		}
	});


	// for (let i = 0; i < 1000; i++) {
	// 	let key = new ethers.SigningKey(ethers.randomBytes(32));
	// 	let signer = ethers.computeAddress(key);
	// 	let hash = ethers.randomBytes(32);
	// 	let sig = key.sign(hash).serialized;
	// 	let [o, r] = await Promise.all([openz, raffy].map(c => c.recover(hash, sig)));
	// 	assert.equal(signer, o);
	// 	assert.equal(signer, r);
	// }
});