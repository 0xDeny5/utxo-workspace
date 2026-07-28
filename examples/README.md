# Examples

Runnable demos for `utxo-coinselect`. Run all commands from the **repository root** after
`pnpm install`.

Root shortcut: `pnpm examples` runs only the Node quick start (`start`).

## Node

```sh
pnpm --filter utxo-coinselect-example-node start
pnpm --filter utxo-coinselect-example-node coin-control
pnpm --filter utxo-coinselect-example-node send-all
pnpm --filter utxo-coinselect-example-node strategies
```

### `start` — everyday payment (`node/index.ts`)

**What it shows:** a normal send with mixed script types and `strategy: "best"`.

- Wallet: one P2WPKH UTXO + one heavier P2WSH 2-of-3 multisig UTXO
- Payment: `180_000` sats to a Taproot output, with Taproot change
- Fee rates: `12` sat/vB now, `3` long-term (for waste)

**What to look for in the log:** which outpoint(s) were chosen, `fee`, `change`, and
`strategy` (the winner inside `best`, e.g. `knapsack` or `branch-and-bound`).

### `coin-control` — force / exclude / confirmations (`node/coin-control.ts`)

**What it shows:** wallet coin-control flags, not “pick any cheap input.”

Setup:

| UTXO          | Flag / filter                 | Role                                      |
| ------------- | ----------------------------- | ----------------------------------------- |
| `must-spend`  | `required: true` + `meta`     | Must appear in `inputs`                   |
| `excluded`    | `excluded: true` (huge value) | Never selected even though it is largest  |
| `unconfirmed` | `confirmations: 0`            | Dropped by `minConfirmations: 1`          |
| `available`   | confirmed                     | Extra funds to reach the `100_000` target |

**What to look for:** `inputs` should include `must-spend` and `available`, never `excluded` or
`unconfirmed`. `meta` should echo `{ label: "forced" }` on the required coin.

### `send-all` — empty the wallet (`node/send-all.ts`)

**What it shows:** `strategy: "split"` (send-all).

- Target has **no `value`** — it receives everything left after fees
- No `change` policy (nothing is kept)

**What to look for:** `balanced: true` means `inputs == outputs + fee`. Outputs are a single
payment amount (no change output).

### `strategies` — compare algorithms (`node/compare-strategies.ts`)

**What it shows:** same wallet + payment, many strategies side by side.

**What to look for:** each line prints `fee`, `waste`, input count, and `used=` (for `best`,
`used` is the inner winner). Lower waste is usually “better” for long-term fee cost; fees can
differ when change / input sets differ.

## Browser

**What it shows:** the library running in a browser (Vite), printing the full JSON
`SelectionResult` (including `bigint` fields as strings).

Dev server (recommended):

```sh
pnpm --filter utxo-coinselect-example-browser dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

Or build and open `examples/browser/dist/index.html`:

```sh
pnpm --filter utxo-coinselect-example-browser build
```
