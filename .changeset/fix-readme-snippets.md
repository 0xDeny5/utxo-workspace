---
"utxo-coinselect": patch
"utxo-descriptors": patch
---

Fix README inaccuracies: `utxo-descriptors` snippets now type-check and run (real descriptors and checksum, `.weight` passed to `selectCoins()`, narrowed results instead of `!`), document the `chain` option for `addr()` and the `expandMultipath()` failure shape; tidy `utxo-coinselect` motivation wording.
