## Foundry

**Foundry is a blazing fast, portable and modular toolkit for Ethereum application development written in Rust.**

Foundry consists of:

- **Forge**: Ethereum testing framework (like Truffle, Hardhat and DappTools).
- **Cast**: Swiss army knife for interacting with EVM smart contracts, sending transactions and getting chain data.
- **Anvil**: Local Ethereum node, akin to Ganache, Hardhat Network.
- **Chisel**: Fast, utilitarian, and verbose solidity REPL.

## Documentation

https://book.getfoundry.sh/

## Usage

### Build

```shell
$ forge build
```

### Test

```shell
$ forge test
```

### Format

```shell
$ forge fmt
```

### Gas Snapshots

```shell
$ forge snapshot
```

### Anvil

```shell
$ anvil
```

### Deploy

```shell
$ forge script script/Counter.s.sol:CounterScript --rpc-url <your_rpc_url> --private-key <your_private_key>
```

## Monad Testnet Deployment Summary

```text
=== Deployment Summary ===
AgentSmartAccount (impl):   0x6C4fAB40717CAb4D359453e11FE4996206a534Fa
AgentAccountFactory:        0x84277eA30ec0a43ED362904308C0A72bF5269196
ReputationReporter (impl):  0xf604E3932869121baF1F751138E32A5F8D912764
ReputationReporter (proxy): 0x2E3A2591561329ED54C88A84aD95E21e6192a907
AgentFactory:               0x2Cd3c8D045b29B1baC914722D85419964DBD79B7
ScoreOracle:                0xE36fa05D875B2475C671A8d5F47421365CE46874
ServiceRegistry:            0xCd5792dDdd3A7b98221223EFE5aCbC302a20A76e
x402Gateway:                0x8887dD91C983b2c647a41DEce32c34E79c7C33df

=== Globals (unchanged) ===
IdentityRegistry:           0x8004A818BFB912233c491871b3d84c89A494BD9e
ReputationRegistry:         0x8004B663056A597Dffe9eCcC1965A193B7388713
EntryPoint v0.7:            0x0000000071727De22E5E9d8BAf0edAc6f37da032
USDC:                       0x534b2f3A21130d7a60830c2Df862319e593943A3
Proxy signer:               0x567bDc4086eFc460811798d1075a21359E34072d
```

### Cast

```shell
$ cast <subcommand>
```

### Help

```shell
$ forge --help
$ anvil --help
$ cast --help
```
