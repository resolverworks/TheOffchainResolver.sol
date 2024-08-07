# TheOffchainResolver.sol

**TOR**  — a trustless universal hybrid off-chain ENS and DNS resolver contract and protocol.

* [**TheOffchainResolver.sol**](./src/TOR.sol)
	* Test: `node test/test.js`
	* Mainnet: [`0x7CE6Cf740075B5AF6b1681d67136B84431B43AbD`](https://etherscan.io/address/0x7CE6Cf740075B5AF6b1681d67136B84431B43AbD#code)
	* Sepolia: [`0x4E7BE27c494a57b4D84eb138F03bE9f43A03604E`](https://sepolia.etherscan.io/address/0x4E7BE27c494a57b4D84eb138F03bE9f43A03604E#code)

## TOR Protocol
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
* `bytes data` = **abi.encoded** `(signature, expires, signedData)`
* reply with `data`

### Implementations

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

### Features

* If all requested records are available on-chain, the off-chain server is not invoked.
* Supports `resolve(multicall([...]))`
* Supports **TOR Lensing**
	* Prefix calldata with `0x000000FF` to only get off-chain values (no on-chain values are accessed)
	* Prefix calldata with `0xFFFFFF00` to only get on-chain values (off-chain server is not invoked)
* Supports `text()`, `addr()`, `contenthash()`, `pubkey()`
* Uses [adraffy/**TinyKV.sol**](https://github.com/adraffy/TinyKV.sol) to minimize storage costs.

#### Fallbacks

* Set `addr(C)` where [`C = keccak256("fallback")`](https://adraffy.github.io/keccak.js/test/demo.html#algo=keccak-256&s=fallback&escape=1&encoding=utf8)
	* `20 bytes` — use another Resolver (on-chain)
	* `32 bytes` — use another Namehash (on-chain)
	* `0 bytes` **Default**  — use `_.[name]`
	* Anything else — disabled
* Priority: TOR > Fallback > Off-chain

#### On-chain Only

* Use `toggleOnchain(bytes32 node)` to enable
* When `onchain(bytes32 node)` is true, the name will never query the off-chain server for additional records and treat unset records as null.
* [Fallbacks](#fallbacks) still functional

---

# DNSTORWithENSProtocol.sol

DNS part of TOR but uses standard ENS signing protocol that is compatible with official [ENS Offchain Resolver](https://github.com/ensdomains/offchain-resolver/).

* [**DNSTORWithENSProtocol.sol**](./src/DNSTORWithENSProtocol.sol)
	* Test: `node test/dns.js`
	* Mainnet: [`0x3CA097Edd180Ea2C2436BD30c021Ca20869087a0`](https://etherscan.io/address/0x3CA097Edd180Ea2C2436BD30c021Ca20869087a0#code)
	* Sepolia: [`0x70A6507f3ee11b86E5c4826F46402c4b6931435d`](https://sepolia.etherscan.io/address/0x70A6507f3ee11b86E5c4826F46402c4b6931435d#code)

---

# eXclusivelyOnchainResolver.sol

**XOR** — a trustless on-chain wildcard resolver contract that translates ENSIP-10 calls into non-ENSIP-10 calls.

* [**eXclusivelyOnchainResolver.sol**](./src/XOR.sol)
	* Test: merged with **TOR**
	* Goerli: [`0x9b87849Aa21889343b6fB1E146f9F734ecFA9982`](https://goerli.etherscan.io/address/0x9b87849Aa21889343b6fB1E146f9F734ecFA9982#code)
* Features
	* works with **any name**
	* supports `resolve(multicall())`

### Usage

Append `.onchain.eth` to any ENS name and resolve!

* Example:
	* Normal: [on.fixed.onchain.eth](https://adraffy.github.io/ens-normalize.js/test/resolver.html?goerli#on.fixed.debug.eth.onchain.eth) (using **TOR**, on/off-chain mixture)
	* Using **XOR** [on.fixed.debug.eth&#8203;**.onchain.eth**](https://adraffy.github.io/ens-normalize.js/test/resolver.html?goerli#on.fixed.debug.eth.onchain.eth) (only on-chain data)

---

# OffchainTunnel.sol

An on-chain function registry for arbitrary CCIP-Read functions.

* [**OffchainTunnel.sol**](./src/OffchainTunnel.sol)
	* `node test/tunnel.js`
	* Sepolia: [`0xCa71342cB02714374e61e400f172FF003497B2c2`](https://sepolia.etherscan.io/address/0xCa71342cB02714374e61e400f172FF003497B2c2#code)

### Function Registry

When `selector` is called with CCIP-Read, the `calldata` is forwarded to the `endpoint` and the response must be signed by `signer`.  The function `selector` is associated with an `(owner, index)`&ndash;pair which points to a `(endpoint, signer)`&ndash;pair.  The CCIP-Read exchange follows the [TOR protocol](#tor-protocol).
* `claimAndSetContext(bytes4 selector, address signer, string calldata endpoint, uint96 index)`
* `claim(bytes4 selector, uint256 index)` + `setContext(address signer, string calldata endpoint, uint96 index)`

### Gasless Debugging
`call(address signer, string memory endpoint, bytes memory request)` does the same thing as above, except the `(signer, endpoint)`&ndash;pair is provided.


## Testing

All contracts have end-to-end [adraffy/**blocksmith**](https://github.com/adraffy/blocksmith.js) tests.

1. [`foundryup`](https://book.getfoundry.sh/getting-started/installation)
1. `forge install`
1. `npm i`
1. `npm run test`
