---
"utxo-coinselect": patch
---

Remove redundant `frozen` UTXO flag; use `excluded: true` for do-not-spend coins (wallet "freeze" maps to `excluded` at the boundary).
