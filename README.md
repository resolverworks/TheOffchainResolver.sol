# TheOffchainResolver.sol
**TOR**  — a trustless universal offchain ENS and DNS resolver contract and protocol.

* Deployments
	* Only one deployment needed per chain!
	* [**TheOffchainDNSResolver.sol**](./contracts/TheOffchainDNSResolver.sol)
		* [`mainnet:0xa4407E257Aa158C737292ac95317a29b4C90729D`](https://etherscan.io/address/0xa4407E257Aa158C737292ac95317a29b4C90729D#code)
		* [`sepolia:0x179Be112b24Ad4cFC392eF8924DfA08C20Ad8583`](https://sepolia.etherscan.io/address/0xedb18cd8d9d6af54c4ac1fbdbf2e098f413c3fe9#code)
	* [**TheOffchainENSResolver.sol**](./contracts/TheOffchainENSResolver.sol)
		* ⚠️ not yet deployed on Mainnet
		* [`goerli:0x2e513399b2c5337E82A0a71992cBD09b78170843`](https://goerli.etherscan.io/address/0x2e513399b2c5337E82A0a71992cBD09b78170843#code)
* Protocol
	* [**resolverworks/ezccip.js**](https://github.com/resolverworks/ezccip.js) → [Implementation](https://github.com/adraffy/ezccip.js/blob/4f05546110185e8016708ad65db8b96e259f8148/src/index.js#L40)
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
