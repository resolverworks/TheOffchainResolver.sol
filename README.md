# TheOffchainResolver.sol
The Universal Offchain (ENS+DNS) Resolver

*Under construction: currently only the DNS functionality is deployed.*

* [Contract](./contracts/TheOffchainResolverMini.sol)
* Deployments:
	* [`mainnet:0xa4407E257Aa158C737292ac95317a29b4C90729D`](https://etherscan.io/address/0xa4407E257Aa158C737292ac95317a29b4C90729D#code)
	* [`sepolia:0x179Be112b24Ad4cFC392eF8924DfA08C20Ad8583`](https://sepolia.etherscan.io/address/0xedb18cd8d9d6af54c4ac1fbdbf2e098f413c3fe9#code)
* Protocol
	* [Signing Logic](https://github.com/adraffy/ezccip.js/blob/4f05546110185e8016708ad65db8b96e259f8148/src/index.js#L40)
	* Implementation: [resolverworks/ezccip.js](https://github.com/adraffy/ezccip.js)
* DNS Example: `ezccip.raffy.xyz` → [DNS TXT](https://mxtoolbox.com/SuperTool.aspx?action=txt%3aezccip.raffy.xyz&run=toolpage) → [ENS](https://app.ens.domains/ezccip.raffy.xyz) / [Resolver](https://adraffy.github.io/ens-normalize.js/test/resolver.html#ezccip.raffy.xyz)

### Context Format

`CONTEXT` = `${SIGNER} ${SERVER_ENDPOINT}`

* `SIGNER` = `0x`-prefixed public address of signing key
* `SERVER_ENDPOINT` = URL of your CCIP-Read server

Example: `0xd00d726b2aD6C81E894DC6B87BE6Ce9c5572D2cd https://raffy.xyz/ezccip/`

### Setup

* *"I have a DNS name"* → `TXT` = `ENS1 0xa4407E257Aa158C737292ac95317a29b4C90729D ${CONTEXT}`
* *"I have an ENS name"* → [PublicResolver](https://etherscan.io/address/resolver.ens.eth)`.setText("ccip.context", CONTEXT)`

That's it! 🎉️ 