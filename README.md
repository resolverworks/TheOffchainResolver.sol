# TheOffchainResolver.sol
**TOR**  — a trustless universal offchain ENS and DNS resolver contract and protocol.

* Deployments
	* Only one deployment per chain!
	* ⭐️ [**TheOffchainResolver.sol**](./contracts/TheOffchainResolver.sol)
		* [`mainnet:0x828ec5bDe537B8673AF98D77bCB275ae1CA26D1f](https://etherscan.io/address/0x828ec5bDe537B8673AF98D77bCB275ae1CA26D1f#code)
		* [`goerli:0x9b87849Aa21889343b6fB1E146f9F734ecFA9982`](https://goerli.etherscan.io/address/0x9b87849Aa21889343b6fB1E146f9F734ecFA9982#code)
		* [`sepolia:0x9Ec7f2ce83fcDF589487303fA9984942EF80Cb39`](https://sepolia.etherscan.io/address/0x9Ec7f2ce83fcDF589487303fA9984942EF80Cb39#code)
	* 🛠️ DNS Only: [**TheOffchainDNSResolver.sol**](./contracts/TheOffchainDNSResolver.sol)
		* [`mainnet:0xa4407E257Aa158C737292ac95317a29b4C90729D`](https://etherscan.io/address/0xa4407E257Aa158C737292ac95317a29b4C90729D#code)
		* [`sepolia:0x179Be112b24Ad4cFC392eF8924DfA08C20Ad8583`](https://sepolia.etherscan.io/address/0xedb18cd8d9d6af54c4ac1fbdbf2e098f413c3fe9#code)
	* 🛠️ ENS Only: [**TheOffchainENSResolver.sol**](./contracts/TheOffchainENSResolver.sol)
		* [`goerli:0x2e513399b2c5337E82A0a71992cBD09b78170843`](https://goerli.etherscan.io/address/0x2e513399b2c5337E82A0a71992cBD09b78170843#code)
		* [`sepolia:0x981294Ee3F2b0dd1734f18E379f8b513Ac991D36`](https://sepolia.etherscan.io/address/0x981294Ee3F2b0dd1734f18E379f8b513Ac991D36#code)
* Protocol
	* [**resolverworks/ezccip.js**](https://github.com/resolverworks/ezccip.js) → [Implementation](https://github.com/resolverworks/ezccip.js/blob/main/test/server.js)
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

## Context Format

### `CONTEXT` = `${SIGNER} ${ENDPOINT}`

* `SIGNER` = `0x`-prefixed public address of signing key
	* `ethers.computeAddress(new ethers.SigningKey("..."))`
* `ENDPOINT` = URL of your CCIP-Read server

### Setup

* *"I have a DNS name"*
	* **DNS TXT** = `ENS1 ${address of TheOffchainDNSResolver} ${CONTEXT}`
		* Example: [`ezccip.raffy.xyz`](https://adraffy.github.io/ens-normalize.js/test/resolver.html#ezccip.raffy.xyz)
		* Context: `0xd00d726b2aD6C81E894DC6B87BE6Ce9c5572D2cd https://raffy.xyz/ezccip/dns`
		* For full wildcard coverage, set `@` (basename) and `*` (descendents)
* *"I have an ENS name"*
	* **ENS.setResolver()** = `address of TheOffchainENSResolver`
	* **setText("ccip.context")** = `CONTEXT`
		* Example: [`ezccip.eth`](https://adraffy.github.io/ens-normalize.js/test/resolver.html?goerli&debug=%7B%22records%22%3A%5B%22ccip.context%22%5D%7D#ezccip.eth)
		* Context: `0xd00d726b2aD6C81E894DC6B87BE6Ce9c5572D2cd https://raffy.xyz/ezccip/ens-goerli`

#### That's it! 🎉️
