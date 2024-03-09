# TheOffchainResolver.sol
**TOR**  — a trustless universal hybrid off-chain ENS and DNS resolver contract and protocol.

* Deployments
	* Only one deployment per chain!
	* [**TheOffchainResolver.sol**](./src/TheOffchainResolver.sol)
		* [`mainnet:0x828ec5bDe537B8673AF98D77bCB275ae1CA26D1f`](https://etherscan.io/address/0x828ec5bDe537B8673AF98D77bCB275ae1CA26D1f#code) 
		* [`goerli:0x9b87849Aa21889343b6fB1E146f9F734ecFA9982`](https://goerli.etherscan.io/address/0x9b87849Aa21889343b6fB1E146f9F734ecFA9982#code)
		* [`sepolia:0xD9b59804B337263142b95e912bD6399A3FD08662`](https://sepolia.etherscan.io/address/0xD9b59804B337263142b95e912bD6399A3FD08662#code)
* Protocol
	* `bytes requestData` = calldata from CCIP-Read
	* `bytes responseData` = the answer to that request
	* `bytes32 requestHash` = **keccak256** of `requestData`
	* `bytes32 responseHash` = **keccak256** of `responseData`
	* `uint64 expires` = expiration time in **seconds** (Ethereum time, since 1/1/1970)
	* `address resolver` = **TOR** contract address
		* use different endpoints to service multiple resolvers (main vs test, DNS vs ENS)
	* `bytes signedData` = **abi.encoded** `(resolver, expires, requestHash, responseHash)`
	* `bytes32 signedHash` = **keccak256** of `signedData`
	* `bytes signature` = **signature** of `signedHash` with private key
	* `bytes data` = **abi.encoded** `(signature, expires, hash)`
	* reply with `data`
* Implementation
	* [**resolverworks/ezccip.js**](https://github.com/resolverworks/ezccip.js) → [Code](https://github.com/resolverworks/ezccip.js/blob/dda3f8313b56b50a5d24e9ec814e66042065f375/src/handler.js#L37) (~5 lines)

## Context Format

### `CONTEXT` = `${SIGNER} ${ENDPOINT}`

* `SIGNER` = `0x`-prefixed public address of signing key
	* `ethers.computeAddress(new ethers.SigningKey("..."))`
* `ENDPOINT` = URL of your CCIP-Read server

### Setup

* *"I have a DNS name"*
	* **DNS TXT** = `ENS1 ${TheOffchainResolver} ${CONTEXT}`
		* Mainnet Example: [`ezccip.raffy.xyz`](https://adraffy.github.io/ens-normalize.js/test/resolver.html#ezccip.raffy.xyz)
		* Context: `0xd00d726b2aD6C81E894DC6B87BE6Ce9c5572D2cd https://raffy.xyz/ezccip/`
		* For full wildcard coverage, set `@` (basename) and `*` (descendents)
* *"I have an ENS name"*
	* **ENS.setResolver()** = `${TheOffchainResolver}`
	* **setText(`"ccip.context"`)** = `CONTEXT`
		* Sepolia Example: [`ezccip.eth`](https://adraffy.github.io/ens-normalize.js/test/resolver.html?sepolia#ezccip.eth)
		* Context: `0xd00d726b2aD6C81E894DC6B87BE6Ce9c5572D2cd https://raffy.xyz/ezccip/s`

#### That's it! 🎉️

---

# eXclusivelyOnchainResolver.sol

**XOR**  — a trustless on-chain wildcard resolver contract that translates ENSIP-10 calls into non-ENSIP-10 calls.

* Deployments
	* Only one deployment per chain!
	* [**eXclusivelyOnchainResolver.sol**](./src/eXclusivelyOnchainResolver.sol)
		* [`goerli:0x9b87849Aa21889343b6fB1E146f9F734ecFA9982`](https://goerli.etherscan.io/address/0x9b87849Aa21889343b6fB1E146f9F734ecFA9982#code)

* Features
	* works with **any name**
	* supports `resolve(multicall())`

### Usage

Append `.onchain.eth` to any ENS name and resolve!

* Example:
	* Normal: [on.fixed.onchain.eth](https://adraffy.github.io/ens-normalize.js/test/resolver.html?goerli#on.fixed.debug.eth.onchain.eth) (using **TOR**, on/off-chain mixture)
	* Using **XOR** [on.fixed.debug.eth&#8203;**.onchain.eth**](https://adraffy.github.io/ens-normalize.js/test/resolver.html?goerli#on.fixed.debug.eth.onchain.eth) (only on-chain data)

---

## Testing

1. `npm i`
1. [foundryup](https://book.getfoundry.sh/getting-started/installation)
1. `npm run test-tor`
