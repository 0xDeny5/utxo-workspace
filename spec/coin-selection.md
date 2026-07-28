# Coin-selection specification

This document defines language-neutral behavior. Normative terms MUST, SHOULD, and MAY follow RFC 2119.

## Units and numeric behavior

- All Bitcoin amounts MUST be signed integers in satoshis (base units).
- Input and output sizes MUST be integer weight units (WU).
- Fee rates are satoshis per virtual byte (sat/vB).
- A fee for weight `w` and fee rate `r` is `ceil(w * r / 4)`.
- Implementations MUST avoid floating-point arithmetic on satoshi amounts.

## Candidate model

Each candidate has an outpoint (`txid` + `vout`), value, maximum input weight, and optional confirmation count, creation order, output group, and script type.

The effective value at fee rate `r` is:

```text
effectiveValue = value - fee(inputWeight, r)
```

Candidates with non-positive effective value SHOULD be skipped by automatic strategies unless force-included by coin control.

## Transaction weight

Input and output weights exclude transaction-level fields. Total weight is:

```text
baseWeight
+ CompactSize(inputCount) * 4
+ CompactSize(outputCount) * 4
+ sum(inputWeights)
+ sum(outputWeights)
```

The default base weight is 34 WU: version and locktime at base serialization weight plus SegWit marker and flag. Consumers MAY override it for exact legacy or protocol-specific transactions.

## Change and dust

A candidate selection is first evaluated without change. If it funds the targets and minimum fee, it
is valid.

When a change policy is present, an implementation MUST calculate the fee with the additional change output. Change is created only when the remaining value is at least the configured dust threshold. If no explicit threshold is given:

```text
dust = fee(changeOutputWeight + futureChangeSpendWeight, dustRelayFeeRate)
```

The default dust relay fee rate is 3 sat/vB. A smaller remainder is added to the transaction fee.

## Waste

Waste compares candidates across strategies.

```text
inputDelta = fee(inputWeights, currentFeeRate)
           - fee(inputWeights, longTermFeeRate)

changelessWaste = inputDelta + excess

changeWaste = inputDelta
            + fee(changeOutputWeight, currentFeeRate)
            + fee(futureChangeSpendWeight, longTermFeeRate)
```

Lower waste wins. Ties are resolved by lower fee, then more inputs (consolidate when otherwise
equivalent), then lower weight.

## Strategies

### Deterministic accumulators

Largest-first, smallest-first, oldest-first (FIFO), newest-first (LIFO), pruned-FIFO, and high-priority-first order candidates and accumulate until finalization succeeds. Detrimental inputs are skipped.

High priority is `value * confirmations`. Pruned-FIFO removes candidates whose effective value does not exceed the change dust floor.

### Blackjack and exact/accumulative matrix

Blackjack accumulates candidates only if they do not exceed the changeless target range. The matrix
first runs Blackjack with one of biggest, smallest, oldest, or newest order and falls back to an
accumulator with an independently selected order.

### Branch-and-Bound

BnB performs a bounded depth-first search over candidates sorted by descending effective value. It searches the range from the selection target through the cost of change, retains the lowest-waste changeless result, prunes branches that cannot reach the target, and skips equivalent candidate branches. The default iteration limit is 100,000.

### CoinGrinder

CoinGrinder performs a bounded search for the minimum input weight that funds the transaction. It is included by the `best` strategy when current fee rate exceeds three times the long-term rate.

### Single Random Draw and Knapsack

SRD uses a seeded Fisher-Yates shuffle followed by accumulation. Knapsack runs seeded randomized
subset passes and compares them with a largest-first fallback. Identical requests and seeds MUST
return identical results.

#### PRNG contract

Randomized strategies use a 32-bit xorshift generator. Ports MUST match this exactly:

1. Let `state` be `seed` interpreted as an unsigned 32-bit integer. When `seed` is omitted, use
   default `0x9e3779b9`.
2. Each draw updates state as:

```text
state ^= (state << 13)
state ^= (state >>> 17)   // logical right shift
state ^= (state << 5)
state = state modulo 2^32
```

1. The returned sample in `[0, 1)` is `state / 2^32` (unsigned 32-bit `state`).
2. Fisher-Yates shuffle for `n` items visits indices `n-1 … 1` and swaps index `i` with
   `floor(random() * (i + 1))`.

### Split and break

Split spends all eligible economical inputs and assigns the post-fee remainder to exactly one
valueless target (send-all). Break spends eligible inputs into as many outputs of the first target
denomination as fit under fees and the maximum transaction weight.

### Best

Best runs a fixed shortlist and returns the minimum-waste success: Branch-and-Bound, Knapsack, Single Random Draw, largest-first, smallest-first, oldest-first, and Blackjack. CoinGrinder is also tried when the current fee rate is more than three times the long-term fee rate. It is the default.

## Coin control and privacy

- Excluded candidates MUST NOT be selected.
- Force-included candidates MUST be selected unless excluded.
- Minimum-confirmation filtering applies to non-required candidates.
- With avoid-partial-spends, candidates sharing a group are atomic.
- With single-script-type preference, homogeneous selections are attempted before the mixed pool.

## Failures

Implementations return a discriminated result. Stable failure reasons are:

- `invalid-request`
- `insufficient-funds`
- `search-exhausted`
- `max-weight-exceeded`

## Conformance

`test-vectors/weights.json` and `test-vectors/coin-selection.json` are normative for exact weights and selection outputs (including failure cases). Implementations in other languages should:

- Parse satoshi amounts from decimal strings.
- Honor optional `seed` for randomized strategies (`knapsack`, `single-random-draw`, and `best` when it falls back to them) using the [PRNG contract](#prng-contract) above.
- Produce the same selected outpoints, fee, change, total weight, and — when present — winning `strategy` name.
- Match `expected.reason` when `expected.ok` is `false`.
