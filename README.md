# UTXO workspace

Accurate, dependency-free UTXO primitives for TypeScript: no keys, no PSBT, no WASM wallet stack — just the pieces a wallet or backend needs to price and select UTXOs, tree-shakeable and usable beside any transaction builder.

This is a monorepo. Each package below is published and versioned independently on npm.

## Table of contents

- [Packages](#packages)
- [Repository layout](#repository-layout)
- [For contributors](#for-contributors)
- [License](#license)

## Packages

| Package                                                                                                                              | npm                                                                                                               | Docs                                         |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [`utxo-coinselect`](packages/utxo-coinselect) — weight-aware coin selection (BnB, waste, CoinGrinder, SRD, compatibility strategies) | [![utxo-coinselect](https://img.shields.io/npm/v/utxo-coinselect)](https://www.npmjs.com/package/utxo-coinselect) | [README](packages/utxo-coinselect/README.md) |

Runnable demos live in [`examples/`](examples/). Normative behavior and golden tests live in [`spec/`](spec/) and [`test-vectors/`](test-vectors/).

## Repository layout

| Path            | Role                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------ |
| `packages/*`    | Published libraries, one directory per npm package                                         |
| `examples/`     | Runnable Node and browser demos                                                            |
| `spec/`         | Language-neutral behavior contracts                                                        |
| `test-vectors/` | Golden cases shared across packages — see [test-vectors/README.md](test-vectors/README.md) |
| `benchmarks/`   | Throughput comparison harness (dev-only competitor deps)                                   |

## For contributors

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, quality gates, pull requests, and releases.

## License

[MIT](LICENSE)
