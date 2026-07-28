# utxo-descriptors

Dependency-free BIP-380 output descriptor parser for TypeScript, with weight estimation that agrees with [`utxo-coinselect`](https://github.com/0xDeny5/utxo-coinselect/tree/main/packages/utxo-coinselect).

You pass a descriptor string; you get back a typed AST, plus the input and output weight (or a scriptPubKey/spending-script description) needed to price it. No keys, no PSBT, no WASM.

```sh
pnpm add utxo-descriptors
```

## Table of contents

- [Motivation](#motivation)
- [Quick start](#quick-start)
- [Composing with `utxo-coinselect`](#composing-with-utxo-coinselect)
- [Supported grammar](#supported-grammar)
- [Multipath](#multipath)
- [Chains](#chains)
- [Scope boundaries](#scope-boundaries)
- [Errors](#errors)
- [Subpath exports](#subpath-exports)
- [See also](#see-also)

## Motivation

[`@bitcoinerlab/descriptors`](https://github.com/bitcoinerlab/descriptors) already parses BIP-380 descriptors and computes weights, but it costs roughly 27 MB installed, ships CommonJS only with no `sideEffects: false` so nothing tree-shakes, bundles 10 MB of test fixtures inside `@bitcoinerlab/secp256k1`, and requires an injected elliptic-curve backend even when you only want structural weight numbers. Its `inputWeight()` also takes a transaction-wide `isSegwitTx` flag, so a single UTXO cannot be priced in isolation, and it infers a script type from an address (assuming any `addr(3...)` is P2SH-P2WPKH), which has produced [wrong dust thresholds](https://github.com/bitcoinerlab/descriptors/issues/43) in practice.

`utxo-descriptors` does one thing: parse the string, price the script. No `ecc` backend to inject, no per-address derivation, no transaction-wide flags — `inputWeight()` and `outputWeight()` take a single script node and always return the same answer for it.

## Quick start

```ts
import { inputWeight, outputWeight, parseDescriptor } from "utxo-descriptors";

const result = parseDescriptor("wsh(multi(2,03a34b...,02cb67...,024cfa...))#8k0h5xxx");

if (!result.ok) {
  throw new Error(`${result.reason}: ${result.message}`);
}

const weight = inputWeight(result.descriptor.script);

if (!weight.ok) {
  throw new Error(`${weight.reason}: ${weight.message}`);
}

console.log(weight.weight); // weight units, ready for utxo-coinselect
```

`outputWeight()` mirrors `inputWeight()` for the scriptPubKey side, and both accept any parsed `ScriptNode` directly, so you can build one by hand instead of parsing a string.

## Composing with `utxo-coinselect`

The whole point of pairing these two packages: descriptors in, `selectCoins()` inputs out.

```ts
import { describeInput, inputWeight, outputWeight, parseDescriptor } from "utxo-descriptors";
import { selectCoins } from "utxo-coinselect";

const receiveDescriptor =
  "wpkh(0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798)";

function priceUtxo(txid: string, vout: number, value: bigint, descriptor: string) {
  const parsed = parseDescriptor(descriptor);

  if (!parsed.ok) throw new Error(parsed.message);

  const weight = inputWeight(parsed.descriptor.script);
  const description = describeInput(parsed.descriptor.script);

  if (!weight.ok) throw new Error(weight.message);
  if (!description.ok) throw new Error(description.message);

  return { txid, vout, value, weight, scriptType: description.description };
}

const parsedTarget = parseDescriptor(receiveDescriptor);

if (!parsedTarget.ok) throw new Error(parsedTarget.message);

const result = selectCoins({
  utxos: [
    priceUtxo(
      "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33",
      0,
      100_000n,
      receiveDescriptor,
    ),
  ],
  targets: [{ value: 50_000n, weight: outputWeight(parsedTarget.descriptor.script) }],
  feeRate: 5,
});
```

`describeInput()`/`describeOutput()` return values that are structurally assignable to `utxo-coinselect`'s `InputType`/`OutputType`, verified by a repo-local cross-package test — see [the runnable version of this example](https://github.com/0xDeny5/utxo-coinselect/tree/main/examples/node/descriptors.ts).

## Supported grammar

- Key expressions: raw hex (compressed, uncompressed, x-only), WIF, and extended `xpub`/`xprv` (Bitcoin) or `tpub`/`tprv` (testnet), each with an optional `[fingerprint/path]` origin and an optional derivation path, including a trailing ranged `/*`.
- Script expressions: `pk()`, `pkh()`, `wpkh()`, `combo()`, `sh()`, `wsh()`, `multi()`/`sortedmulti()`, `raw()`, `addr()`, and `tr()` — key-path only or with a script-path tree of `pk()` leaves.
- The BIP-380 checksum: `checksumCreate()` and `checksumVerify()`, exported directly for callers that only need checksum handling.

Every context and key-count rule from BIP-381 through BIP-386 (for example: compressed-only keys under `wsh()`, x-only-only keys under `tr()`, `sh()`/`combo()`/`raw()`/`addr()`/`tr()` valid only at the top level) is enforced by the parser, not left to weight computation. See [spec/descriptors.md](https://github.com/0xDeny5/utxo-coinselect/tree/main/spec/descriptors.md) for the normative rules.

## Multipath

[BIP-389](https://github.com/bitcoin/bips/blob/master/bip-0389.mediawiki) multipath (`<0;1>`) expands into one descriptor per tuple position:

```ts
import { expandMultipath } from "utxo-descriptors";

const parsed = parseDescriptor("wpkh([d34db33f/84h/0h/0h]xpub.../<0;1>/*)");
const expanded = expandMultipath(parsed.descriptor!.script);
// expanded.descriptors[0] -> the receive-chain (…/0/*) descriptor
// expanded.descriptors[1] -> the change-chain (…/1/*) descriptor
```

Tuple elements may be hardened independently and in any order; duplicates within a tuple are rejected, matching the BIP rather than the stricter subset some implementations accept.

## Chains

Weight and address-decoding functions accept a `chain` option; `BITCOIN` (mainnet) is the default. Bitcoin testnet/signet/regtest and Litecoin mainnet presets are exported from `utxo-descriptors` as plain data, so adding another chain does not require forking the parser.

## Scope boundaries

This package deliberately does not:

- **Derive keys.** Extended keys are classified and their paths parsed, but no child key is ever computed — there is no elliptic-curve or HMAC-SHA512 code in this package.
- **Produce scriptPubKeys or addresses (level 3).** Nothing here turns a descriptor into a scriptPubKey or an address. `addr()`'s own address is decoded only far enough to price its output.
- **Verify base58check checksums.** Doing so needs SHA256, which a zero-dependency v1 does not carry. `addr()` handling decodes the base58 payload for its version byte and length without verifying the trailing checksum; bech32/bech32m checksums _are_ verified, since they need no hashing. Use a wallet library (e.g. a library backed by `@noble/hashes` or `@bitcoinerlab/secp256k1`) if you need real address validation.
- **Understand miniscript.** A `wsh()`/`tr()` leaf other than a bare `pk()` fragment (e.g. `and_v(...)`, `older(...)`, threshold fragments) fails clearly with an `unsupported`/`invalid-context` reason rather than a wrong weight. Satisfaction-size computation for arbitrary miniscript is the `rust-miniscript` `max_satisfaction_size` problem and is planned for a future `0.2.0`.

## Errors

Every function returns a discriminated `{ ok: true, ... } | { ok: false, reason, message }` result; nothing here throws on malformed _input_. Parse failures carry a stable `reason` (`invalid-character`, `invalid-checksum`, `unexpected-token`, `unknown-function`, `invalid-key-expression`, `invalid-context`, `key-count-exceeded`, `unsupported`) and, when known, a character `position`. Weight failures carry `opaque-script` (for `addr()`/`raw()` input pricing, where the spending script is genuinely unknown) or `ambiguous-script-type` (for `combo()`, which represents several candidate scripts at once) or `unsupported` (an out-of-scope nesting or miniscript fragment).

## Subpath exports

```ts
import { parseDescriptor } from "utxo-descriptors/parse";
import { inputWeight, outputWeight } from "utxo-descriptors/weights";
```

Both subpaths are also re-exported from the package root; import from a subpath only if you want your bundler to see that you never touch the other half.

## See also

- [`utxo-coinselect`](https://github.com/0xDeny5/utxo-coinselect/tree/main/packages/utxo-coinselect) — the coin-selection engine this package's weights feed.
- [spec/descriptors.md](https://github.com/0xDeny5/utxo-coinselect/tree/main/spec/descriptors.md) — the normative grammar and weight-assumption contract.
- [Root README](https://github.com/0xDeny5/utxo-coinselect#readme) — the family overview.
