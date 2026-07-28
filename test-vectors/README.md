# Test vectors

Language-neutral golden cases shared across this workspace's packages.

| File                  | Role                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `weights.json`        | Weight fixtures — normative for `utxo-coinselect` and any package that prices descriptors |
| `coin-selection.json` | Selection fixtures for `utxo-coinselect` (normative expectations)                         |
| `descriptors.json`    | Parse fixtures (valid and invalid) for `utxo-descriptors`                                 |
| `schema.json`         | Loose JSON Schema for the vector files above                                              |

`weights.json` is the cross-package contract: any package that computes input or output weight from its own representation must agree with these cases. Keeping it as one shared file, rather than a copy per package, is what makes that agreement enforceable. Its entries carry an optional `descriptor` field so `utxo-descriptors` can derive the same case `utxo-coinselect` prices from its named `inputType` catalog.

## Spec

Behavioral rules live in [spec/coin-selection.md](../spec/coin-selection.md) (including the PRNG contract for seeded strategies) and [spec/descriptors.md](../spec/descriptors.md) (BIP-380 grammar, multipath, and weight assumptions).
