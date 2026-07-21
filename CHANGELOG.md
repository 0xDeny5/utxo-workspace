# Changelog

All notable changes will be documented here.

The project follows Semantic Versioning and uses Changesets to prepare releases.

## 0.1.0

- Initial weight-aware coin-selection engine.
- Modern, deterministic, randomized, and compatibility strategies.
- Removed `legacyCoinselect` and the `utxo-coinselect/compat` entrypoint. Use `selectCoins` with
  explicit weights instead.
- Documented the full strategy catalog, motivation, install flow, examples, and versioning in the
  root README.
- Stopped tracking generated TypeDoc (`docs/api/`) and IDE metadata (`.idea/`).
- Removed the standalone bitcoinjs migration guide and `SECURITY.md` in favor of a streamlined
  README.
- Expanded Node examples (coin control, send-all, strategy comparison) and made the benchmark
  compare both `best` and `accumulative`.
- Removed the optional `utxo-coinselect-descriptors` package from this monorepo (use
  `inputWeight` / `outputWeight` catalog helpers instead).
- Expanded `test-vectors/core.json` with blackjack, accumulative, CoinGrinder, knapsack, SRD,
  `best` (low/high fee), insufficient-funds, and coin-control cases.
