import { base58Decode } from "./base58";
import { bech32Decode } from "./bech32";
import type { ChainParams } from "./chains";
import { BITCOIN } from "./chains";
import { collectTapLeaves } from "./traverse";
import type {
  KeyMaterialKind,
  ScriptNode,
  WeightFailure,
  WeightFailureReason,
  WeightResult,
} from "./types";

/** Conservative single-key ECDSA signature bytes, matching utxo-coinselect's p2pk/p2pkh/p2wpkh constants. */
const ECDSA_SINGLE_SIG_BYTES = 72;
/** Conservative multisig ECDSA signature bytes, matching utxo-coinselect's MultisigWeight default. */
const ECDSA_MULTISIG_SIG_BYTES = 73;
/** Schnorr signature bytes for a Taproot key-path spend under SIGHASH_DEFAULT (no trailing sighash byte). */
const SCHNORR_KEYPATH_SIG_BYTES = 64;
/** Schnorr signature bytes assumed for a Taproot script-path spend, matching utxo-coinselect's P2TR_SCRIPT default. */
const SCHNORR_SCRIPTPATH_SIG_BYTES = 65;
const COMPRESSED_PUBKEY_BYTES = 33;
const UNCOMPRESSED_PUBKEY_BYTES = 65;
const XONLY_PUBKEY_BYTES = 32;
const P2PKH_SCRIPT_BYTES = 25;
const P2WPKH_SCRIPT_BYTES = 22;
const P2SH_SCRIPT_BYTES = 23;
const P2WSH_SCRIPT_BYTES = 34;
const P2TR_SCRIPT_BYTES = 34;
const BASE58_ADDRESS_BYTES = 25;
const LEGACY_TX_OVERHEAD_BYTES = 40;
const VOUT_OVERHEAD_BYTES = 8;
const WEIGHT_SCALE = 4;
const PUSHDATA_OP_MAX = 0x4c;
const PUSHDATA_UINT8_MAX = 0xff;
const PUSHDATA_UINT16_MAX = 0xffff;
const COMPACT_SIZE_UINT16_MIN = 253;
const COMPACT_SIZE_UINT16_MAX = 0xffff;
const COMPACT_SIZE_UINT32_MAX = 0xffff_ffff;

function weightFail(reason: WeightFailureReason, message: string): WeightFailure {
  return { ok: false, reason, message };
}

/** Exported for direct unit testing of its boundaries; not part of the public barrel. */
export function compactSizeBytes(value: number): number {
  if (value < COMPACT_SIZE_UINT16_MIN) {
    return 1;
  }

  if (value <= COMPACT_SIZE_UINT16_MAX) {
    return 3;
  }

  if (value <= COMPACT_SIZE_UINT32_MAX) {
    return 5;
  }

  return 9;
}

/** Exported for direct unit testing of its boundaries; not part of the public barrel. */
export function pushDataPrefixBytes(length: number): number {
  if (length < PUSHDATA_OP_MAX) {
    return 1;
  }

  if (length <= PUSHDATA_UINT8_MAX) {
    return 2;
  }

  if (length <= PUSHDATA_UINT16_MAX) {
    return 3;
  }

  return 5;
}

function keyMaterialBytes(kind: KeyMaterialKind): number {
  switch (kind) {
    case "hex-compressed":
    case "wif-compressed":
    case "xpub":
    case "xprv":
      return COMPRESSED_PUBKEY_BYTES;
    case "hex-uncompressed":
    case "wif-uncompressed":
      return UNCOMPRESSED_PUBKEY_BYTES;
    case "hex-xonly":
      return XONLY_PUBKEY_BYTES;
  }
}

type SimpleOutputNode = Extract<
  ScriptNode,
  { readonly kind: "pk" | "pkh" | "wpkh" | "sh" | "wsh" | "tr" | "multi" }
>;

/** Byte length of the scriptPubKey these fragments would produce if used directly as an output. */
function simpleOutputScriptBytes(node: SimpleOutputNode): number {
  switch (node.kind) {
    case "pk":
      return keyMaterialBytes(node.key.kind) + 2;
    case "pkh":
      return P2PKH_SCRIPT_BYTES;
    case "wpkh":
      return P2WPKH_SCRIPT_BYTES;
    case "sh":
      return P2SH_SCRIPT_BYTES;
    case "wsh":
      return P2WSH_SCRIPT_BYTES;
    case "tr":
      return P2TR_SCRIPT_BYTES;
    case "multi": {
      const perKey = node.keys.reduce((sum, key) => {
        const bytes = keyMaterialBytes(key.kind);

        return sum + pushDataPrefixBytes(bytes) + bytes;
      }, 0);

      return 1 + perKey + 2;
    }
  }
}

interface Cost {
  readonly scriptSig: number;
  readonly witness: number;
}

type LeafInputNode = Extract<ScriptNode, { readonly kind: "pk" | "pkh" | "wpkh" | "multi" }>;

function leafInputCost(node: LeafInputNode): Cost {
  switch (node.kind) {
    case "pk": {
      const scriptSig = pushDataPrefixBytes(ECDSA_SINGLE_SIG_BYTES) + ECDSA_SINGLE_SIG_BYTES;

      return { scriptSig, witness: 0 };
    }

    case "pkh": {
      const keyBytes = keyMaterialBytes(node.key.kind);
      const scriptSig =
        pushDataPrefixBytes(ECDSA_SINGLE_SIG_BYTES) +
        ECDSA_SINGLE_SIG_BYTES +
        pushDataPrefixBytes(keyBytes) +
        keyBytes;

      return { scriptSig, witness: 0 };
    }

    case "wpkh": {
      const keyBytes = keyMaterialBytes(node.key.kind);
      const items = 2;
      const witness =
        compactSizeBytes(items) +
        compactSizeBytes(ECDSA_SINGLE_SIG_BYTES) +
        ECDSA_SINGLE_SIG_BYTES +
        compactSizeBytes(keyBytes) +
        keyBytes;

      return { scriptSig: 0, witness };
    }

    case "multi": {
      const sigCost = pushDataPrefixBytes(ECDSA_MULTISIG_SIG_BYTES) + ECDSA_MULTISIG_SIG_BYTES;

      return { scriptSig: 1 + node.threshold * sigCost, witness: 0 };
    }
  }
}

type WitnessScriptNode = Extract<ScriptNode, { readonly kind: "pk" | "pkh" | "multi" }>;

/** Complete P2WSH witness bytes (item count, satisfaction items, and the witness script itself). */
function segwitWitnessBytes(node: WitnessScriptNode): number {
  switch (node.kind) {
    case "pk": {
      const scriptBytes = simpleOutputScriptBytes(node);
      const items = 2;

      return (
        compactSizeBytes(items) +
        compactSizeBytes(ECDSA_SINGLE_SIG_BYTES) +
        ECDSA_SINGLE_SIG_BYTES +
        compactSizeBytes(scriptBytes) +
        scriptBytes
      );
    }

    case "pkh": {
      const keyBytes = keyMaterialBytes(node.key.kind);
      const items = 3;

      return (
        compactSizeBytes(items) +
        compactSizeBytes(ECDSA_SINGLE_SIG_BYTES) +
        ECDSA_SINGLE_SIG_BYTES +
        compactSizeBytes(keyBytes) +
        keyBytes +
        compactSizeBytes(P2PKH_SCRIPT_BYTES) +
        P2PKH_SCRIPT_BYTES
      );
    }

    case "multi": {
      const scriptBytes = simpleOutputScriptBytes(node);
      const sigCost = compactSizeBytes(ECDSA_MULTISIG_SIG_BYTES) + ECDSA_MULTISIG_SIG_BYTES;
      const items = node.threshold + 2;

      return (
        compactSizeBytes(items) +
        compactSizeBytes(0) +
        node.threshold * sigCost +
        compactSizeBytes(scriptBytes) +
        scriptBytes
      );
    }
  }
}

function computeTrCost(node: Extract<ScriptNode, { readonly kind: "tr" }>): Cost {
  const keyPathWitness =
    compactSizeBytes(1) + compactSizeBytes(SCHNORR_KEYPATH_SIG_BYTES) + SCHNORR_KEYPATH_SIG_BYTES;

  if (node.tree === undefined) {
    return { scriptSig: 0, witness: keyPathWitness };
  }

  const leafWitnesses = collectTapLeaves(node.tree).map(({ depth }) => {
    const leafScriptBytes = 1 + XONLY_PUBKEY_BYTES + 1;
    const controlBlockBytes = 1 + XONLY_PUBKEY_BYTES + XONLY_PUBKEY_BYTES * depth;
    const items = 3;

    return (
      compactSizeBytes(items) +
      compactSizeBytes(SCHNORR_SCRIPTPATH_SIG_BYTES) +
      SCHNORR_SCRIPTPATH_SIG_BYTES +
      compactSizeBytes(leafScriptBytes) +
      leafScriptBytes +
      compactSizeBytes(controlBlockBytes) +
      controlBlockBytes
    );
  });

  return { scriptSig: 0, witness: Math.max(keyPathWitness, ...leafWitnesses) };
}

type CostResult = ({ readonly ok: true } & Cost) | WeightFailure;

function computeInputCost(node: ScriptNode): CostResult {
  switch (node.kind) {
    case "pk":
    case "pkh":
    case "wpkh":
    case "multi":
      return { ok: true, ...leafInputCost(node) };
    case "sh": {
      const { inner } = node;

      if (inner.kind === "wpkh") {
        const redeemBytes = simpleOutputScriptBytes(inner);

        return {
          ok: true,
          scriptSig: pushDataPrefixBytes(redeemBytes) + redeemBytes,
          witness: leafInputCost(inner).witness,
        };
      }

      if (inner.kind === "wsh") {
        const { inner: innerInner } = inner;

        if (innerInner.kind !== "pk" && innerInner.kind !== "pkh" && innerInner.kind !== "multi") {
          return weightFail(
            "unsupported",
            `sh(wsh(${innerInner.kind}(...))) is not a supported nesting`,
          );
        }

        const redeemBytes = P2WSH_SCRIPT_BYTES;

        return {
          ok: true,
          scriptSig: pushDataPrefixBytes(redeemBytes) + redeemBytes,
          witness: segwitWitnessBytes(innerInner),
        };
      }

      if (inner.kind === "pk" || inner.kind === "pkh" || inner.kind === "multi") {
        const redeemBytes = simpleOutputScriptBytes(inner);

        return {
          ok: true,
          scriptSig:
            leafInputCost(inner).scriptSig + pushDataPrefixBytes(redeemBytes) + redeemBytes,
          witness: 0,
        };
      }

      return weightFail("unsupported", `sh(${inner.kind}(...)) is not a supported nesting`);
    }

    case "wsh": {
      const { inner } = node;

      if (inner.kind === "pk" || inner.kind === "pkh" || inner.kind === "multi") {
        return { ok: true, scriptSig: 0, witness: segwitWitnessBytes(inner) };
      }

      return weightFail("unsupported", `wsh(${inner.kind}(...)) is not a supported nesting`);
    }

    case "tr":
      return { ok: true, ...computeTrCost(node) };
    case "combo":
      return weightFail(
        "ambiguous-script-type",
        "combo() represents multiple candidate script types; describe the specific script you intend to spend instead",
      );
    case "raw":
      return weightFail(
        "opaque-script",
        "raw() has no known spending script, so its input weight cannot be determined",
      );
    case "addr":
      return weightFail(
        "opaque-script",
        "addr() has no known spending script, so its input weight cannot be determined",
      );
  }
}

export interface WeightOptions {
  /** Only used to interpret `addr()` base58 version bytes. Defaults to Bitcoin mainnet. */
  readonly chain?: ChainParams;
}

function decodeAddressScriptBytes(
  address: string,
  chain: ChainParams,
): { readonly ok: true; readonly value: number } | WeightFailure {
  const segwit = bech32Decode(address);

  if (segwit !== undefined) {
    return { ok: true, value: 2 + segwit.program.length };
  }

  const decoded = base58Decode(address);

  if (decoded?.length === BASE58_ADDRESS_BYTES) {
    const version = decoded[0];

    if (version === chain.base58PubKeyHash) {
      return { ok: true, value: P2PKH_SCRIPT_BYTES };
    }

    if (version === chain.base58ScriptHash) {
      return { ok: true, value: P2SH_SCRIPT_BYTES };
    }
  }

  return weightFail("unsupported", `unrecognized address for chain '${chain.name}': ${address}`);
}

type ScriptBytesResult = { readonly ok: true; readonly value: number } | WeightFailure;

function computeOutputScriptBytes(node: ScriptNode, options: WeightOptions): ScriptBytesResult {
  switch (node.kind) {
    case "pk":
    case "pkh":
    case "wpkh":
    case "sh":
    case "wsh":
    case "tr":
    case "multi":
      return { ok: true, value: simpleOutputScriptBytes(node) };
    case "combo":
      return weightFail(
        "ambiguous-script-type",
        "combo() represents multiple candidate scriptPubKeys; describe the specific script you intend to create instead",
      );
    case "raw":
      if (node.hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(node.hex)) {
        return weightFail("unsupported", "raw() requires an even-length hex string");
      }

      return { ok: true, value: node.hex.length / 2 };
    case "addr":
      return decodeAddressScriptBytes(node.address, options.chain ?? BITCOIN);
  }
}

/** Return the maximum absolute input weight in weight units, under segwit transaction serialization. */
export function inputWeight(node: ScriptNode): WeightResult {
  const cost = computeInputCost(node);

  if (!cost.ok) {
    return cost;
  }

  const baseBytes = LEGACY_TX_OVERHEAD_BYTES + compactSizeBytes(cost.scriptSig) + cost.scriptSig;

  return { ok: true, weight: baseBytes * WEIGHT_SCALE + cost.witness };
}

/** Return the serialized output weight in weight units. */
export function outputWeight(node: ScriptNode, options: WeightOptions = {}): WeightResult {
  const scriptBytesResult = computeOutputScriptBytes(node, options);

  if (!scriptBytesResult.ok) {
    return scriptBytesResult;
  }

  const weight =
    (VOUT_OVERHEAD_BYTES + compactSizeBytes(scriptBytesResult.value) + scriptBytesResult.value) *
    WEIGHT_SCALE;

  return { ok: true, weight };
}

export interface DescribedMultisig {
  readonly type: "p2sh-multisig" | "p2wsh-multisig" | "p2sh-p2wsh-multisig";
  readonly m: number;
  readonly n: number;
}

export interface DescribedRawInput {
  readonly type: "raw";
  readonly scriptSigBytes: number;
  readonly witnessBytes: number;
}

export type DescribedInput =
  "p2pk" | "p2pkh" | "p2wpkh" | "p2sh-p2wpkh" | "p2tr" | DescribedMultisig | DescribedRawInput;

export type DescribeInputResult =
  { readonly ok: true; readonly description: DescribedInput } | WeightFailure;

/**
 * Maps a descriptor fragment to a value structurally assignable to
 * `utxo-coinselect`'s `InputType`, without either package depending on the
 * other. Fails with `opaque-script` for `addr()`/`raw()` (spending script
 * unknown) and `ambiguous-script-type` for `combo()` (multiple candidate
 * scripts). Every other supported fragment always succeeds, falling back to
 * an exact `{ type: "raw", ... }` shape when there is no named catalog entry.
 */
export function describeInput(node: ScriptNode): DescribeInputResult {
  const cost = computeInputCost(node);

  if (!cost.ok) {
    return cost;
  }

  if (node.kind === "pk") {
    return { ok: true, description: "p2pk" };
  }

  if (node.kind === "pkh") {
    return { ok: true, description: "p2pkh" };
  }

  if (node.kind === "wpkh") {
    return { ok: true, description: "p2wpkh" };
  }

  if (node.kind === "tr" && node.tree === undefined) {
    return { ok: true, description: "p2tr" };
  }

  if (node.kind === "sh" && node.inner.kind === "wpkh") {
    return { ok: true, description: "p2sh-p2wpkh" };
  }

  if (node.kind === "sh" && node.inner.kind === "multi") {
    return {
      ok: true,
      description: { type: "p2sh-multisig", m: node.inner.threshold, n: node.inner.keys.length },
    };
  }

  if (node.kind === "wsh" && node.inner.kind === "multi") {
    return {
      ok: true,
      description: { type: "p2wsh-multisig", m: node.inner.threshold, n: node.inner.keys.length },
    };
  }

  if (node.kind === "sh" && node.inner.kind === "wsh" && node.inner.inner.kind === "multi") {
    return {
      ok: true,
      description: {
        type: "p2sh-p2wsh-multisig",
        m: node.inner.inner.threshold,
        n: node.inner.inner.keys.length,
      },
    };
  }

  return {
    ok: true,
    description: { type: "raw", scriptSigBytes: cost.scriptSig, witnessBytes: cost.witness },
  };
}

export interface DescribedRawOutput {
  readonly type: "raw";
  readonly scriptPubKeyBytes: number;
}

export type DescribedOutput =
  "p2pk" | "p2pkh" | "p2sh" | "p2wpkh" | "p2wsh" | "p2tr" | DescribedRawOutput;

export type DescribeOutputResult =
  { readonly ok: true; readonly description: DescribedOutput } | WeightFailure;

/** Maps a descriptor fragment to a value structurally assignable to `utxo-coinselect`'s `OutputType`. */
export function describeOutput(
  node: ScriptNode,
  options: WeightOptions = {},
): DescribeOutputResult {
  const scriptBytesResult = computeOutputScriptBytes(node, options);

  if (!scriptBytesResult.ok) {
    return scriptBytesResult;
  }

  // computeOutputScriptBytes already failed above for combo(), so every kind
  // reaching this switch other than combo is representable here.
  const resolvedNode = node as Exclude<ScriptNode, { readonly kind: "combo" }>;

  switch (resolvedNode.kind) {
    case "pk":
      return { ok: true, description: "p2pk" };
    case "pkh":
      return { ok: true, description: "p2pkh" };
    case "wpkh":
      return { ok: true, description: "p2wpkh" };
    case "sh":
      return { ok: true, description: "p2sh" };
    case "wsh":
      return { ok: true, description: "p2wsh" };
    case "tr":
      return { ok: true, description: "p2tr" };
    case "multi":
    case "raw":
    case "addr":
      return { ok: true, description: { type: "raw", scriptPubKeyBytes: scriptBytesResult.value } };
  }
}
