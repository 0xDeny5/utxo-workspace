# utxo-coinselect

## 1.1.0

### Minor Changes

- c95ad74: Add `utxo-coinselect/compat`, a drop-in replacement for bitcoinjs/coinselect. `coinSelect`, `accumulative`, `blackjack`, `split` and `broken` keep coinselect's arguments and result shape (numbers, objects returned by reference, a bare `{ value }` change output), but use this package's Bitcoin Core fee and dust rules. Pass `weight` on UTXOs and outputs for exact SegWit and Taproot pricing, and an optional 4th `options` argument to pick a strategy or change policy. Failures carry an extra `error: { reason, message }`.

## 1.0.0

### Major Changes

- 2a49f37: First stable release: accuracy, performance and packaging fixes. Some results change, so review before upgrading.

  `utxo-coinselect`

  - Fees are now `ceil(ceil(weight / 4) * feeRate)`, like Bitcoin Core, so `fee / vsize` is never below the requested rate (previously `ceil(weight * feeRate / 4)`, up to ¾ vB short).
  - The default dust floor is never below Bitcoin Core's relay dust limit (`GetDustThreshold`). Taproot change below 330 sats and P2SH change below 540 sats is no longer created. New `relayDustThreshold()` helper.
  - Change is only created when it is worth more than it costs to spend later at `longTermFeeRate` (Core's `min_viable_change`).
  - Branch-and-Bound no longer skips solutions when several UTXOs have identical value and weight. Branch-and-Bound and Blackjack results are always changeless inside their cost-of-change window.
  - `split` (send-all) fails instead of creating a dust output.
  - `selectBranchAndBound`, `selectCoinGrinder`, `selectKnapsack`, `selectSingleRandomDraw` and `selectBest` now validate their input like `selectCoins`. Validation also rejects non-bigint amounts and invalid change-policy and numeric options instead of throwing.
  - Weight-limited selections report `max-weight-exceeded` instead of `insufficient-funds`; `best` reports the most specific failure.
  - Randomized strategies draw a seed from `crypto.getRandomValues` when `seed` is omitted (previously a fixed constant). `seed: 0` no longer freezes the generator.
  - Multisig with `m` or `n` above 16 counts the 2-byte push; `P2SH_MULTISIG` rejects redeemScripts over 520 bytes (more than 15 keys).
  - Much faster on large wallets: `best` on 2,000 UTXOs went from about 23 s to well under a second. Knapsack runs at most 1,000 rounds regardless of `maxIterations`.

  `utxo-descriptors`

  - `describeInput()`/`describeOutput()` return the exact `raw` shape for scripts with uncompressed keys (previously named entries that `utxo-coinselect` prices as compressed).
  - `multi()` weights count the 2-byte push for `m` or `n` above 16.
  - The parser rejects uncompressed keys in `tr()`, tapscript trees deeper than 128, more than one multipath group per key, and `sh(multi())` redeemScripts over 520 bytes.
  - `addr()` checks the bech32 prefix against the chain, witness version (at most 16) and v0 program length. New `BITCOIN_REGTEST` chain preset.

  Both packages: the `exports` map now points CommonJS consumers at `.d.cts` types (previously "masquerading as ESM" under `node16` resolution) and exposes `./package.json`.

### Patch Changes

- 3673dfc: Fix README inaccuracies: `utxo-descriptors` snippets now type-check and run (real descriptors and checksum, `.weight` passed to `selectCoins()`, narrowed results instead of `!`), document the `chain` option for `addr()` and the `expandMultipath()` failure shape; tidy `utxo-coinselect` motivation wording.

## 0.1.4

### Patch Changes

- 102048b: Remove redundant `frozen` UTXO flag; use `excluded: true` for do-not-spend coins (wallet "freeze" maps to `excluded` at the boundary).

## 0.1.3

### Patch Changes

- Improve project motivation wording and harden coverage for uneconomical accumulator inputs.

## 0.1.2

### Patch Changes

- Link npm README "See also" and Strategies to GitHub URLs so they work on npmjs.com.

## 0.1.1

### Patch Changes

- Trim root contributor docs and clean the 0.1.0 changelog for the public package page.
