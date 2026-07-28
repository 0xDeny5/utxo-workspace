# Test vectors

Language-neutral golden cases shared across this workspace's packages.

| File                  | Role                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `weights.json`        | Weight fixtures — normative for `utxo-coinselect` and any package that prices descriptors |
| `coin-selection.json` | Selection fixtures for `utxo-coinselect` (normative expectations)                         |
| `schema.json`         | Loose JSON Schema for the vector files above                                              |

`weights.json` is the cross-package contract: any package that computes input or output weight from its own representation must agree with these cases. Keeping it as one shared file, rather than a copy per package, is what makes that agreement enforceable.

## Spec

Behavioral rules live in [spec/coin-selection.md](../spec/coin-selection.md) (including the PRNG contract for seeded strategies).
