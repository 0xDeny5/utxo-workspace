# UTXO workspace

Accurate, dependency-free UTXO primitives for TypeScript: no keys, no PSBT, no WASM wallet stack — just the pieces a wallet or backend needs to price and select UTXOs, tree-shakeable and usable beside any transaction builder.

This is a monorepo. Each package below is published and versioned independently.

## Packages

| Package                                       | Description                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [`utxo-coinselect`](packages/utxo-coinselect) | Weight-aware Bitcoin UTXO coin selection: modern (BnB, waste, CoinGrinder, SRD) and compatibility strategies |

## Install

```sh
pnpm add utxo-coinselect
# or
npm install utxo-coinselect
# or
yarn add utxo-coinselect
```

## Examples

```ts
import { inputWeight, outputWeight, selectCoins } from "utxo-coinselect";

const result = selectCoins({
  utxos: [
    {
      txid: "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
      vout: 0,
      value: 100_000n,
      weight: inputWeight("p2wpkh"),
    },
  ],
  targets: [{ value: 40_000n, weight: outputWeight("p2wpkh") }],
  feeRate: 5,
  change: {
    outputWeight: outputWeight("p2wpkh"),
    spendWeight: inputWeight("p2wpkh"),
  },
});

if (!result.ok) {
  throw new Error(`${result.reason}: ${result.message}`);
}

console.log(result.inputs, result.fee, result.change);
```

See [`utxo-coinselect`](packages/utxo-coinselect/README.md) for the full API and more examples, and [`examples/`](examples/) for runnable Node and browser demos.

## Strategies

Full strategy catalog and guidance on choosing one: [Strategies in `utxo-coinselect`](packages/utxo-coinselect/README.md#strategies).

## Repository layout

| Path            | Role                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------ |
| `packages/*`    | Published libraries, one directory per npm package                                         |
| `examples/`     | Runnable Node/browser demos                                                                |
| `spec/`         | Language-neutral behavior contracts                                                        |
| `test-vectors/` | Golden cases shared across packages — see [test-vectors/README.md](test-vectors/README.md) |
| `benchmarks/`   | Throughput comparison harness (dev-only competitor deps)                                   |

## For contributors

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, quality gates, PRs, and releases.

## License

[MIT](LICENSE)
