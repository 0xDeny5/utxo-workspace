---
"utxo-coinselect": minor
---

Add `utxo-coinselect/compat`, a drop-in replacement for bitcoinjs/coinselect. `coinSelect`, `accumulative`, `blackjack`, `split` and `broken` keep coinselect's arguments and result shape (numbers, objects returned by reference, a bare `{ value }` change output), but use this package's Bitcoin Core fee and dust rules. Pass `weight` on UTXOs and outputs for exact SegWit and Taproot pricing, and an optional 4th `options` argument to pick a strategy or change policy. Failures carry an extra `error: { reason, message }`.
