# utxo-coinselect

Modern, dependency-free Bitcoin UTXO coin selection engine for TypeScript.

## Table of contents

- [Motivation](#motivation)
- [Install](#install)
- [Example of usage](#example-of-usage)
- [How selection works](#how-selection-works)
- [Strategies](#strategies)
- [Coin control and privacy](#coin-control-and-privacy)
- [For contributors](#for-contributors)

## Motivation

Existing Typescript Coin Selection libraries often trade off between simplicity, accuracy, and algorithmic flexibility. This package was created to fill this gap: a standalone engine combining accurate UTXO weight estimation with wide variety of modern selection algorithms. For instance, [bitcoinjs/coinselect](https://github.com/bitcoinjs/coinselect), hardcodes sizes of UTXOs (which affects the "cost") whenever you omit an explicit "script" field — so SegWit, Taproot, and especially multisig systematically misprice fees and change. In addition, it lacks a broad set of modern coin-selection strategies.

Looking for a drop-in fix, the JS/TS landscape split awkwardly:

| Library                                                                        | Accurate per-type weights?                                   | Modern algorithms (BnB, waste, ...)?     |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------- |
| [bitcoinjs/coinselect](https://github.com/bitcoinjs/coinselect)                | No — hardcodes roughly P2PKH input size + no TS support even | No — blackjack + accumulative            |
| [@bitcoinerlab/coinselect](https://github.com/bitcoinerlab/coinselect)         | Yes                                                          | Mostly the same heuristics               |
| [@scure/btc-signer](https://github.com/paulmillr/scure-btc-signer)             | Yes                                                          | Heuristic matrix                         |
| [bdk_coin_select](https://docs.rs/bdk_coin_select) (Rust) / Bitcoin Core (C++) | Yes                                                          | Yes — but not a small pure-TS dependency |

Core and BDK already solved the _algorithm_ side (Branch-and-Bound, waste metric, CoinGrinder, SRD, ...). However, such libraries lack a **tiny, selection-only TypeScript library**: no keys, no PSBT, no WASM wallet stack — just UTXOs in, chosen inputs / change / fee / waste out, with callers supplying (or catalog-deriving) accurate per-input weights.

So, **accurate weight modeling** brings this approach to TS: accurate weight modeling (including M-of-N multisig and Taproot) **and** the modern Core/BDK-style algorithm suite, tree-shakeable and usable beside any transaction builder.

## Install

```sh
pnpm add utxo-coinselect
# or
npm install utxo-coinselect
# or
yarn add utxo-coinselect
```

Requirements: **Node.js 20+**, or any runtime with ES2020 + `bigint` (modern browsers, edge workers).

## Example of usage

### Minimal

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

`change` **is optional but important.** If you omit it, leftover value after paying targets and fees is **added to the miner fee** (no change output). Pass `change` whenever you want a change output back to the wallet.

### Richer example

```ts
import { inputWeight, outputWeight, P2WSH_MULTISIG, selectCoins } from "utxo-coinselect";

const result = selectCoins({
  utxos: [
    {
      txid: "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
      vout: 0,
      value: 120_000n,
      weight: inputWeight("p2wpkh"),
      scriptType: "p2wpkh",
      confirmations: 12,
      meta: { label: "savings" },
    },
    {
      txid: "f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16",
      vout: 1,
      value: 250_000n,
      weight: inputWeight(P2WSH_MULTISIG(2, 3)),
      scriptType: "p2wsh-2-of-3",
      confirmations: 100,
    },
  ],
  targets: [{ value: 180_000n, weight: outputWeight("p2tr"), meta: { to: "alice" } }],
  feeRate: 5, // sat/vB
  longTermFeeRate: 3, // (optional) used by the waste metric
  change: {
    outputWeight: outputWeight("p2tr"),
    spendWeight: inputWeight("p2tr"),
  },
  strategy: "best", // default: tries several strategies; slowest option
});

if (!result.ok) {
  throw new Error(`${result.reason}: ${result.message}`);
}

console.log({
  inputs: result.inputs.map((utxo) => ({
    txid: utxo.txid,
    vout: utxo.vout,
    meta: utxo.meta,
  })),
  fee: result.fee,
  change: result.change,
  waste: result.waste,
  strategyUsed: result.strategy,
  outputs: result.outputs,
});
```

### What you get back

```ts
type SelectionResult =
  | {
      ok: true;
      inputs: Utxo[];
      outputs: { value: bigint; weight: number; isChange: boolean; meta?: unknown }[];
      fee: bigint;
      change: bigint; // 0n when changeless
      waste: bigint;
      weight: number; // total tx weight (WU)
      strategy: StrategyName; // strategy that produced this solution
    }
  | {
      ok: false;
      reason: "insufficient-funds" | "invalid-request" | "search-exhausted" | "max-weight-exceeded";
      message: string;
      available?: bigint;
      required?: bigint;
    };
```

### Important conventions

- **Amounts are** `bigint` **satoshis.** Convert at your API boundary: `BigInt(apiValue)`.
- **Fee rates are** `number` **sat/vB** and may be fractional. Fee math still avoids floating-point on amounts (`ceil(weight * rate / 4)`).
- **Weights are weight units (WU).** Use `inputWeight(...)` / `outputWeight(...)` instead of guessing byte sizes.
- **Results are a discriminated union** (see above) — never a silent `undefined`.
- **Custom fields belong in** `meta`**.** Selected inputs/outputs preserve `meta` for your wallet data.
- `scriptType` is optional unless you use `preferSingleScriptType`.

## How selection works

1. Each UTXO has an **effective value**: `value − fee(inputWeight, feeRate)`.
2. Strategies search for a set of inputs that funds the targets plus fees.
3. Change is created only when the leftover is above the dust threshold; otherwise the leftover is added to the miner fee (changeless).
4. Candidates are compared with the **waste metric** (changeful vs changeless forms), so “better” means lower long-term fee cost, not only “first solution found”.

Normative behavior lives in [spec/coin-selection.md](spec/coin-selection.md). Shared golden cases live in [test-vectors/](test-vectors/).

## Strategies

Pass `strategy` on the request (default `"best"`), or call a dedicated helper such as `selectBranchAndBound`. The full list is exported as `STRATEGY_NAMES`.

### Default meta-strategy

| Name   | What it does                                               | When to use                                       |
| ------ | ---------------------------------------------------------- | ------------------------------------------------- |
| `best` | Runs several strategies and keeps the lowest-waste success | Everyday wallet sends when a few dozen ms is fine |

`best` typically tries Branch-and-Bound, Knapsack, Single Random Draw, largest/smallest/oldest-first, and Blackjack. CoinGrinder is included when the current fee rate is more than 3× the long-term rate.

### Modern search (Core / BDK family)

| Name                 | Aliases | Short explanation                                                                                    |
| -------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `branch-and-bound`   | `bnb`   | Depth-first search for a **changeless** solution in a bounded waste window; prunes hopeless branches |
| `coingrinder`        | —       | Bounded search that minimizes **input weight** (useful when fees are high)                           |
| `single-random-draw` | `srd`   | Shuffle UTXOs with a seedable RNG, then accumulate until funded                                      |
| `knapsack`           | —       | Randomized subset passes, then compare with a largest-first fallback                                 |

### Deterministic orderings

| Name                  | Short explanation                                                                      |
| --------------------- | -------------------------------------------------------------------------------------- |
| `largest-first`       | Spend highest effective-value UTXOs first                                              |
| `smallest-first`      | Prefer small UTXOs (can reduce change, may raise input count)                          |
| `oldest-first`        | FIFO by timestamp / confirmations                                                      |
| `newest-first`        | LIFO by timestamp / confirmations                                                      |
| `pruned-fifo`         | Oldest-first after dropping UTXOs whose effective value is below the change dust floor |
| `high-priority-first` | Order by `value * confirmations`                                                       |

### Compatibility heuristics (JS ecosystem)

| Name              | Short explanation                                                                  |
| ----------------- | ---------------------------------------------------------------------------------- |
| `blackjack`       | Try to hit a changeless “sweet spot” without overshooting                          |
| `accumulative`    | Keep adding ordered UTXOs until the payment is funded                              |
| `exact-*/accum-*` | Blackjack-style exact pass, then accumulative fallback, with independent orderings |

There are 16 matrix names of the form `exact-{biggest|smallest|oldest|newest}/accum-{biggest|smallest|oldest|newest}`.

**Note:** `strategy: "blackjack"` does **not** automatically fall back to accumulative. For that chaining, call blackjack then accumulative yourself, or use a matrix strategy such as `exact-biggest/accum-biggest`.

### Distribution helpers

| Name    | Short explanation                                          |
| ------- | ---------------------------------------------------------- |
| `split` | Send-all / even remainder into one valueless target output |
| `break` | Break funded value into equal denomination outputs         |

### Choosing a strategy quickly

| Goal                                           | Suggested `strategy`                 |
| ---------------------------------------------- | ------------------------------------ |
| Best fee / waste trade-off for normal payments | `best` (default)                     |
| Fast path comparable to old `coinselect`       | `accumulative` or `blackjack`        |
| Prefer no change output                        | `branch-and-bound` / `bnb`           |
| High fee environment, minimize weight          | `coingrinder`                        |
| Deterministic, explainable ordering            | `largest-first`, `oldest-first`, ... |
| Send entire wallet balance                     | `split`                              |

Randomized strategies (`srd`, `knapsack`, and anything that uses them inside `best`) accept `seed` and are **deterministic for the same request + seed**.

## Coin control and privacy

| Option                            | Effect                                                                    |
| --------------------------------- | ------------------------------------------------------------------------- |
| `required: true` on a UTXO        | Must be included (unless excluded/frozen)                                 |
| `excluded: true` / `frozen: true` | Never selected                                                            |
| `minConfirmations`                | Skip non-required UTXOs below the threshold                               |
| `avoidPartialSpends`              | UTXOs sharing `group` are selected atomically (output groups / APS-style) |
| `preferSingleScriptType`          | Prefer a homogeneous `scriptType` set before mixing                       |

`preferSingleScriptType` is inspired by Bitcoin Core discussions around keeping input script types uniform (see Core [#24584](https://github.com/bitcoin/bitcoin/pull/24584) lineage). Attach wallet metadata with `meta` rather than inventing ad-hoc top-level fields.

## For contributors

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, quality gates, PRs, and releases.
Runnable demos: [examples/](examples/) ([examples/README.md](examples/README.md)).
Behavior contract: [spec/coin-selection.md](spec/coin-selection.md). Conformance vectors:
[test-vectors/](test-vectors/).

## License

[MIT](LICENSE)
