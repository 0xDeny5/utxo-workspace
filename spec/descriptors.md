# Descriptors specification

This document defines language-neutral behavior for parsing BIP-380 output descriptors and pricing the scripts they describe. Normative terms MUST, SHOULD, and MAY follow RFC 2119.

## Scope

In scope for v1 (`utxo-descriptors@0.x`):

- The checksum and grammar of [BIP-380](https://github.com/bitcoin/bips/blob/master/bip-0380.mediawiki).
- The script expressions of BIP-381 (`pk`, `pkh`, `wpkh`, `combo`), BIP-382 (`sh`), BIP-383 (`multi`/`sortedmulti`), BIP-384 (`addr`, `raw`), BIP-385 (`wsh`), and BIP-386 (`tr`, key-path and script-path with `pk()` leaves).
- [BIP-389](https://github.com/bitcoin/bips/blob/master/bip-0389.mediawiki) multipath expansion.
- Weight estimation for every supported script expression.

Out of scope for v1, stated so expectations are set correctly:

- **Key derivation.** No child public/private keys are ever computed. Extended keys are classified and their derivation paths are parsed structurally, but no HMAC-SHA512 or elliptic-curve arithmetic is performed.
- **scriptPubKeys and addresses (level 3).** No function in this package derives a scriptPubKey or address from a descriptor. `addr()`'s own address is decoded only far enough to price its output (and, for base58, to read its version byte); no scriptPubKey is produced for it, and no other script type is ever turned into an address.
- **PSBT.** Nothing here builds, reads, or signs a PSBT.
- **Miniscript.** Fragments inside `wsh()` or `tr()` leaves other than a bare `pk()` (e.g. `and_v(...)`, `older(...)`, threshold fragments) are rejected with a clear `unsupported` weight failure or an `invalid-context`/`unexpected-token` parse failure, never a silently wrong number. Satisfaction-size computation for arbitrary miniscript is the `rust-miniscript` `max_satisfaction_size` problem and is deferred to a future minor version.

## Checksum

- The checksum algorithm MUST implement the BIP-380 BCH-style `polymod` over the 3-group input charset, producing an 8-character checksum from the descriptor's payload characters and a `#` separator.
- `checksumCreate` MUST be pure: identical input strings produce identical checksums.
- `checksumVerify` MUST reject a descriptor whose trailing `#xxxxxxxx` does not match the checksum computed from the preceding payload.
- A descriptor with no `#checksum` suffix MUST parse successfully; checksums are optional on input.

## Grammar and parsing

- Parsing MUST be total: no input string, however malformed, causes the parser to throw. Every input produces a `ParseResult`.
- Failures MUST report one of the stable `ParseFailureReason` values (`invalid-character`, `invalid-checksum`, `unexpected-token`, `unknown-function`, `invalid-key-expression`, `invalid-context`, `key-count-exceeded`, `unsupported`), a human-readable `message`, and a `position` when a specific character offset is known.
- Context rules that MUST be enforced during parsing, not left to weight computation:
  - `sh()`, `combo()`, `raw()`, `addr()`, and `tr()` are valid only as the entire top-level expression, never nested inside another script expression.
  - `sh()` may wrap `pk()`, `pkh()`, `wpkh()`, `multi()`/`sortedmulti()`, or `wsh(...)`; nothing else.
  - `wsh()` may wrap `pk()`, `pkh()`, or `multi()`/`sortedmulti()`; nesting another `sh()`, `wsh()`, or `tr()` inside `wsh()` is rejected.
  - Compressed-only key material is required directly under `wsh(...)` (uncompressed keys inside `wsh()` are rejected per BIP-382/385).
  - x-only key material (no `02`/`03`/`04` prefix) is accepted only under `tr()`; every other script expression requires a prefixed key.
  - Key count limits: a `multi()`/`sortedmulti()` at the top level or directly under `sh()` allows at most 15 keys; under `wsh()` (including `sh(wsh(...))`) at most 20 keys; a bare top-level `multi()` follows the top-level limit of 3 per BIP-383's non-`sh`/`wsh` case as implemented here.
- Key origins (`[fingerprint/path]key`) MUST be validated structurally: an 8-character lowercase-hex fingerprint, and a path of `/`-separated steps each either a plain index, a hardened index (`'`, `h`, or `H` suffix), or, at the tail, a BIP-389 multipath group.
- Multipath groups (`<a;b;...>`) are valid only as a single path step; a descriptor mixing a multipath group with further path steps after it is otherwise parsed normally, since the tail-position rule applies to the multipath step itself, not to what follows.

## Multipath expansion

- `expandMultipath` MUST return the original script node, unchanged, wrapped as the single element of `descriptors`, when no key in the tree contains a multipath element.
- When one or more keys contain a multipath element, every such element MUST have the same tuple length; a mismatch MUST fail with `ok: false` rather than silently truncating or padding.
- Tuple elements MAY be hardened independently and MAY appear in any order; duplicate values within one tuple MUST be rejected.
- Expansion MUST produce exactly one descriptor per tuple position, substituting the corresponding value at each multipath element and leaving every other part of the key (origin, non-multipath path steps, key material) unchanged.

## Weight assumptions

All sizes are conservative maximums, matching the constants `utxo-coinselect` uses for its named catalog entries, so that agreement is possible in the first place:

- ECDSA signatures: 72 bytes for a single-key spend, 73 bytes for each signature inside a multisig satisfaction (both include the low-S DER upper bound plus a trailing sighash byte).
- Schnorr signatures: 64 bytes for a Taproot key-path spend under `SIGHASH_DEFAULT`, 65 bytes for a Taproot script-path spend (includes a non-default sighash byte).
- Public key material: 33 bytes compressed (including WIF-compressed and extended keys, which always yield compressed public keys), 65 bytes uncompressed, 32 bytes x-only.
- `inputWeight()` returns the absolute input weight, in weight units, under **segwit transaction serialization** — i.e. it always includes the marker/flag overhead's effect on how witness data is counted, matching `utxo-coinselect`'s existing `inputWeight("p2wpkh")` convention. It does not accept and does not need a transaction-wide "is this tx segwit" flag: a legacy-only transaction's fee estimate from these weights is conservative (an overestimate by the small marker/flag/witness-count saving), never an underestimate.
- `outputWeight()` returns the serialized output weight in weight units: value (8 bytes) plus the CompactSize-prefixed scriptPubKey, scaled by 4.
- Taproot script-path spends with multiple leaves use the maximum witness size across all leaves (deepest control block, one signature), since the caller does not know in advance which leaf will be used to spend.
- `raw()` and `addr()` price only as outputs, never as inputs: their spending script is unknown, so `inputWeight()` on either MUST fail with reason `opaque-script` rather than guessing. `outputWeight()` succeeds for both, because a scriptPubKey's byte length (or an address's decoded payload length) is knowable without knowing how it will ever be spent.
- `combo()` represents several candidate script types simultaneously (bare key, P2PKH, P2WPKH, and P2SH-P2WPKH all share one key). Both `inputWeight()` and `outputWeight()` MUST fail with reason `ambiguous-script-type`, directing the caller to describe the specific script they intend to use.
- Address decoding for `addr()` verifies bech32/bech32m checksums (no hashing required) but does **not** verify base58check's SHA256d checksum, since computing it would require a hash implementation this package deliberately does not carry. A version byte or witness program that decodes structurally but does not match any of the chain's known prefixes MUST fail with reason `unsupported`.

## `describeInput()` / `describeOutput()`

- `describeInput()` and `describeOutput()` map a parsed script node to a value structurally assignable to `utxo-coinselect`'s `InputType`/`OutputType` unions, without either package importing the other.
- Every script expression that `inputWeight()`/`outputWeight()` can price MUST also have a `describeInput()`/`describeOutput()` result; the two MUST fail for exactly the same inputs and for the same reasons.
- A script shape with no named catalog entry (e.g. a bare top-level `multi()`, or an `addr()`/`raw()` output) MUST fall back to an explicit `{ type: "raw", ... }` shape carrying the byte counts needed to reconstruct its weight, rather than being dropped or approximated.

## Chain parameters

- Chain-specific data (BIP-32 extended-key version bytes, base58 P2PKH/P2SH version bytes, bech32 human-readable part) MUST be supplied as a plain data object, not hardcoded per chain in the parser or tokenizer. Bitcoin mainnet is the default; Bitcoin testnet/signet/regtest and Litecoin mainnet presets are provided.

## Conformance

`test-vectors/descriptors.json` is normative for parse results (both success and every documented failure reason) and `test-vectors/weights.json` is normative for the shared weight cases both `utxo-descriptors` and `utxo-coinselect` must agree on. Implementations in other languages should:

- Parse the exact descriptor string given, with no normalization beyond what this spec requires.
- Match `expected.reason` when `expected.ok` is `false`, and match the full parsed structure (script kind, keys, and any threshold/tree) when `expected.ok` is `true`.
- Reproduce the exact `expectedWeight` in `test-vectors/weights.json` for the paired `descriptor` field.
