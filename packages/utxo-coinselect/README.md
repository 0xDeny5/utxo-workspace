# utxo-coinselect

Dependency-free, weight-aware Bitcoin UTXO coin selection for TypeScript.

You pass UTXOs, payment targets, and a fee rate; you get selected inputs, outputs (including optional change), fee, and a waste score. No keys, PSBTs, or wallet sync.

```sh
pnpm add utxo-coinselect
```

## Table of contents

- [Motivation](#motivation)
- [Quick start](#quick-start)
- [Full `selectCoins` request](#full-selectcoins-request-every-option)
- [Result shape](#result-shape)
- [More examples](#more-examples)
- [Weights](#weights)
- [How selection works](#how-selection-works)
- [Strategies](#strategies)
- [Coin control and privacy](#coin-control-and-privacy)
- [See also](#see-also)

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

## Quick start

```ts
import { inputWeight, outputWeight, selectCoins } from "utxo-coinselect";

const result = selectCoins({
  // required — spendable coins
  utxos: [
    {
      txid: "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
      vout: 0,
      value: 100_000n, // satoshis (bigint)
      weight: inputWeight("p2wpkh"),
    },
  ],
  // required — at least one payment target
  targets: [{ value: 50_000n, weight: outputWeight("p2wpkh") }],
  // required — sat/vB for this transaction
  feeRate: 5,
  // optional — but recommended for normal sends (omit = never create change)
  change: {
    outputWeight: outputWeight("p2wpkh"), // creating the change output now
    spendWeight: inputWeight("p2wpkh"), // spending that change later
  },
});

if (!result.ok) {
  throw new Error(`${result.reason}: ${result.message}`);
}

console.log(result.inputs, result.fee, result.change, result.waste);
```

## Full `selectCoins` request (every option)

```ts
import {
  inputWeight,
  outputWeight,
  P2WSH_MULTISIG,
  selectCoins,
  STRATEGY_NAMES,
} from "utxo-coinselect";

const result = selectCoins({
  // ── required ──────────────────────────────────────────────────────────
  utxos: [
    {
      // required — outpoint (unique within this request)
      txid: "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
      vout: 0,
      // required — amount in satoshis
      value: 120_000n,
      // required — input weight in WU (use inputWeight(...) helpers)
      weight: inputWeight("p2wpkh"),

      // optional — confirmations (minConfirmations / oldest-newest / high-priority-first)
      confirmations: 12,
      // optional — creation order (oldest-first / newest-first); falls back to confirmations
      timestamp: 1_700_000_000,
      // optional — spend atomically with other UTXOs that share this key (see avoidPartialSpends)
      group: "same-address",
      // optional — label for preferSingleScriptType (free-form string, not used for fee math)
      scriptType: "p2wpkh",
      // optional — must be included (unless excluded/frozen)
      required: false,
      // optional — never select
      excluded: false,
      // optional — same as excluded (wallet “freeze”)
      frozen: false,
      // optional — your data; echoed back on selected inputs
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

  // required — non-empty list of outputs you want to create
  targets: [
    {
      // optional — omit only for strategy "split" (send-all / fill remainder)
      value: 180_000n,
      // required — output weight in WU
      weight: outputWeight("p2tr"),
      // optional — echoed on that selected output
      meta: { to: "alice" },
    },
  ],

  // required — fee rate for this tx (sat/vB; may be fractional)
  feeRate: 5,

  // ── optional request fields ───────────────────────────────────────────
  // optional — assumed future fee rate for waste / change cost (default = feeRate)
  longTermFeeRate: 3,
  // optional — strategy name (default "best"); see STRATEGY_NAMES
  strategy: "best",
  // optional — change policy; omit = never create a change output (leftover -> fee)
  change: {
    // required when `change` is set — weight of the change output in this tx
    outputWeight: outputWeight("p2tr"),
    // required when `change` is set — weight to spend that change later
    spendWeight: inputWeight("p2tr"),
    // optional — explicit dust floor in sats (default derived from dustRelayFeeRate)
    dustThreshold: undefined,
    // optional — sat/vB used to derive dust (default 3, Core-style)
    dustRelayFeeRate: 3,
  },
  // optional — fixed tx overhead WU excluding vin/vout CompactSize (default 34)
  baseWeight: 34,
  // optional — max total tx weight (default 400_000)
  maxWeight: 400_000,
  // optional — search budget for BnB / CoinGrinder (default 100_000)
  maxIterations: 100_000,
  // optional — RNG seed for deterministic srd / knapsack / best
  seed: 42,
  // optional — skip non-required UTXOs below this confirmation count
  minConfirmations: 1,
  // optional — select UTXOs with the same `group` together
  avoidPartialSpends: false,
  // optional — try homogeneous scriptType pools before mixing (needs scriptType on UTXOs)
  preferSingleScriptType: false,
});

// STRATEGY_NAMES lists every accepted strategy string (including exact-*/accum-* matrix)
void STRATEGY_NAMES;
```

## Result shape

```ts
if (!result.ok) {
  // result.reason: "insufficient-funds" | "invalid-request" | "search-exhausted" | "max-weight-exceeded"
  // result.message: human-readable detail
  // result.available? / result.required? — satoshis when relevant
  throw new Error(result.message);
}

// result.ok === true
result.inputs; // selected UTXOs (same objects you passed, including meta)
result.outputs; // payment outputs + optional change ({ value, weight, isChange, meta? })
result.fee; // miner fee (satoshis)
result.change; // change amount (0n if changeless)
result.waste; // waste score (lower is better)
result.weight; // final transaction weight (WU)
result.strategy; // strategy that produced this success
```

## More examples

### Coin control

```ts
const result = selectCoins({
  utxos: [
    {
      txid: "aa",
      vout: 0,
      value: 40_000n,
      weight: inputWeight("p2wpkh"),
      required: true, // force include
      confirmations: 6,
    },
    {
      txid: "bb",
      vout: 1,
      value: 500_000n,
      weight: inputWeight("p2wpkh"),
      frozen: true, // never select
      confirmations: 100,
    },
    {
      txid: "cc",
      vout: 2,
      value: 80_000n,
      weight: inputWeight("p2wpkh"),
      confirmations: 3,
    },
  ],
  targets: [{ value: 100_000n, weight: outputWeight("p2wpkh") }],
  feeRate: 4,
  minConfirmations: 1, // optional — drops unconfirmed non-required coins
  change: {
    outputWeight: outputWeight("p2wpkh"),
    spendWeight: inputWeight("p2wpkh"),
  },
  strategy: "largest-first", // optional
});
```

### Send-all (`split`)

Exactly one target may omit `value`; it receives the post-fee remainder.

```ts
const result = selectCoins({
  utxos: [
    { txid: "aa", vout: 0, value: 75_000n, weight: inputWeight("p2tr") },
    { txid: "bb", vout: 1, value: 40_000n, weight: inputWeight("p2tr") },
  ],
  targets: [{ weight: outputWeight("p2tr") }], // value omitted on purpose
  feeRate: 3,
  strategy: "split",
  // change omitted — split spends everything into the open target(s)
});
```

### Dedicated strategy helpers

Same request shape; strategy is fixed:

```ts
import {
  selectAccumulative,
  selectBranchAndBound,
  selectBlackjack,
  selectCoinGrinder,
  selectKnapsack,
  selectSingleRandomDraw,
} from "utxo-coinselect";
```

## Weights

Prefer catalog helpers instead of hardcoding WU. Subpath: `utxo-coinselect/weights`.

```ts
import {
  inputWeight,
  outputWeight,
  P2SH_MULTISIG,
  P2WSH_MULTISIG,
  P2SH_P2WSH_MULTISIG,
  P2TR_SCRIPT,
  feeForWeight,
  weightToVBytes,
  dustThresholdFor,
} from "utxo-coinselect";

// ── Input weights (spend cost) ──────────────────────────────────────────

inputWeight("p2pk"); // legacy pay-to-pubkey
inputWeight("p2pkh"); // legacy pay-to-pubkey-hash
inputWeight("p2wpkh"); // native SegWit v0
inputWeight("p2sh-p2wpkh"); // nested SegWit (P2SH-P2WPKH)
inputWeight("p2tr"); // Taproot key-path spend (cheapest Taproot case)

// Multisig (m-of-n). Optional signatureBytes defaults to a conservative max ECDSA size.
inputWeight(P2SH_MULTISIG(2, 3)); // legacy P2SH multisig
inputWeight(P2WSH_MULTISIG(2, 3)); // native P2WSH multisig
inputWeight(P2SH_P2WSH_MULTISIG(2, 3)); // nested P2SH-P2WSH multisig
inputWeight({ ...P2WSH_MULTISIG(2, 3), signatureBytes: 72 });

// Taproot script-path spend — see options below
inputWeight(P2TR_SCRIPT(/* scriptBytes */ 34, /* signatures */ 1));
inputWeight(
  P2TR_SCRIPT(70, 2, {
    // Extra witness stack items (bytes each), besides the signatures + script + control block
    stackElementBytes: [0, 32],
    // Merkle path length in the control block (0 = script is the only leaf)
    controlBlockDepth: 2,
    // Per-signature size; default 65 (schnorr + sighash-style budget used by the catalog)
    signatureBytes: 64,
  }),
);

// Escape hatch: exact scriptSig / witness sizes when the catalog does not fit
inputWeight({ type: "raw", scriptSigBytes: 107, witnessBytes: 0 }); // e.g. unusual legacy
inputWeight({ type: "raw", scriptSigBytes: 0, witnessBytes: 66 }); // custom witness-only

// ── Output weights (create cost) ────────────────────────────────────────

outputWeight("p2pk");
outputWeight("p2pkh");
outputWeight("p2sh");
outputWeight("p2wpkh");
outputWeight("p2wsh");
outputWeight("p2tr");
outputWeight("p2a"); // pay-to-anchor (ephemeral anchor output)
outputWeight({ type: "raw", scriptPubKeyBytes: 34 }); // custom scriptPubKey length

// ── Related helpers ─────────────────────────────────────────────────────

weightToVBytes(272); // WU -> vbytes (ceil)
feeForWeight(272, 5); // ceil(weight/4 * feeRate) as bigint sats
dustThresholdFor(outputWeight("p2wpkh"), inputWeight("p2wpkh")); // Core-style dust
```

### Taproot options (`P2TR_SCRIPT`)

| Argument / option    | Meaning                                                        |
| -------------------- | -------------------------------------------------------------- |
| `scriptBytes`        | Serialized leaf script size (bytes)                            |
| `signatures`         | How many signatures appear in the witness                      |
| `stackElementBytes?` | Extra non-signature stack items, each given as its byte length |
| `controlBlockDepth?` | Control-block merkle depth (default `0`)                       |
| `signatureBytes?`    | Bytes per signature including sighash budget (default `65`)    |

Key-path spends use `inputWeight("p2tr")` — no `P2TR_SCRIPT`. Script-path spends need `P2TR_SCRIPT` so the witness (script + control block + stack) is costed correctly.

## How selection works

1. Each UTXO has an **effective value**: `value − fee(inputWeight, feeRate)`.
2. Strategies search for a set of inputs that funds the targets plus fees.
3. Change is created only when the leftover is above the dust threshold; otherwise the leftover is added to the miner fee (changeless).
4. Candidates are compared with the **waste metric** (changeful vs changeless forms), so "better" means lower long-term fee cost, not only "first solution found".

Normative behavior lives in [spec/coin-selection.md](https://github.com/0xDeny5/utxo-coinselect/blob/main/spec/coin-selection.md). Shared golden cases live in [test-vectors/](https://github.com/0xDeny5/utxo-coinselect/blob/main/test-vectors/).

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
| `blackjack`       | Try to hit a changeless "sweet spot" without overshooting                          |
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

## See also

- Behavior contract: [spec/coin-selection.md](https://github.com/0xDeny5/utxo-coinselect/blob/main/spec/coin-selection.md)
- Runnable demos: [examples/README.md](https://github.com/0xDeny5/utxo-coinselect/blob/main/examples/README.md)
