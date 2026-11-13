---
"utxo-coinselect": major
"utxo-descriptors": major
---

First stable release: accuracy, performance and packaging fixes. Some results change, so review before upgrading.

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
