import type { ChangePolicy, Weight } from "./types";

export interface MultisigWeight {
  readonly type: "p2sh-multisig" | "p2wsh-multisig" | "p2sh-p2wsh-multisig";
  readonly m: number;
  readonly n: number;
  /** Maximum serialized ECDSA signature bytes, including sighash. */
  readonly signatureBytes?: number;
}

export interface TaprootScriptWeight {
  readonly type: "p2tr-script";
  readonly scriptBytes: number;
  readonly signatures: number;
  readonly stackElementBytes?: readonly number[];
  readonly controlBlockDepth?: number;
  readonly signatureBytes?: number;
}

export interface RawInputWeight {
  readonly type: "raw";
  /** scriptSig bytes excluding its CompactSize prefix. */
  readonly scriptSigBytes?: number;
  /** Complete witness serialization bytes; zero for legacy inputs. */
  readonly witnessBytes?: number;
}

export type InputType =
  | "p2pk"
  | "p2pkh"
  | "p2wpkh"
  | "p2sh-p2wpkh"
  | "p2tr"
  | MultisigWeight
  | TaprootScriptWeight
  | RawInputWeight;

export type OutputType =
  | "p2pk"
  | "p2pkh"
  | "p2sh"
  | "p2wpkh"
  | "p2wsh"
  | "p2tr"
  | "p2a"
  | { readonly type: "raw"; readonly scriptPubKeyBytes: number };

export const P2SH_MULTISIG = (m: number, n: number): MultisigWeight => ({
  type: "p2sh-multisig",
  m,
  n,
});

export const P2WSH_MULTISIG = (m: number, n: number): MultisigWeight => ({
  type: "p2wsh-multisig",
  m,
  n,
});

export const P2SH_P2WSH_MULTISIG = (m: number, n: number): MultisigWeight => ({
  type: "p2sh-p2wsh-multisig",
  m,
  n,
});

export const P2TR_SCRIPT = (
  scriptBytes: number,
  signatures: number,
  options: Omit<TaprootScriptWeight, "type" | "scriptBytes" | "signatures"> = {},
): TaprootScriptWeight => ({
  type: "p2tr-script",
  scriptBytes,
  signatures,
  ...options,
});

/** Number of bytes used by Bitcoin's CompactSize encoding. */
export function compactSizeBytes(value: number | bigint): number {
  const n = typeof value === "bigint" ? value : BigInt(assertInteger(value, "value"));

  if (n < 0n) {
    throw new RangeError("CompactSize value cannot be negative");
  }

  if (n < 253n) {
    return 1;
  }

  if (n <= 0xffffn) {
    return 3;
  }

  if (n <= 0xffff_ffffn) {
    return 5;
  }

  return 9;
}

function assertInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }

  return value;
}

function pushDataPrefixBytes(length: number): number {
  assertInteger(length, "pushdata length");

  if (length < 0x4c) {
    return 1;
  }

  if (length <= 0xff) {
    return 2;
  }

  if (length <= 0xffff) {
    return 3;
  }

  return 5;
}

function multisigScriptBytes(n: number): number {
  return 3 + 34 * n;
}

function validateMultisig(type: MultisigWeight): Required<MultisigWeight> {
  const m = assertInteger(type.m, "multisig m");
  const n = assertInteger(type.n, "multisig n");

  if (m < 1 || m > n || n > 20) {
    throw new RangeError("multisig must satisfy 1 <= m <= n <= 20");
  }

  const signatureBytes = assertInteger(type.signatureBytes ?? 73, "signatureBytes");

  return { ...type, m, n, signatureBytes };
}

/**
 * Return the maximum input weight in weight units.
 *
 * Constants use conservative standard satisfaction sizes. For unusual scripts,
 * use `raw` or `P2TR_SCRIPT` and provide exact witness details.
 */
export function inputWeight(input: InputType): Weight {
  if (typeof input === "string") {
    switch (input) {
      case "p2pk":
        return 456;
      case "p2pkh":
        return 592;
      case "p2wpkh":
        return 272;
      case "p2sh-p2wpkh":
        return 364;
      case "p2tr":
        return 230;
    }
  }

  if (input.type === "raw") {
    const scriptSig = assertInteger(input.scriptSigBytes ?? 0, "scriptSigBytes");
    const witness = assertInteger(input.witnessBytes ?? 0, "witnessBytes");
    const baseBytes = 32 + 4 + compactSizeBytes(scriptSig) + scriptSig + 4;

    return baseBytes * 4 + witness;
  }

  if (input.type === "p2tr-script") {
    const scriptBytes = assertInteger(input.scriptBytes, "scriptBytes");
    const signatures = assertInteger(input.signatures, "signatures");
    const signatureBytes = assertInteger(input.signatureBytes ?? 65, "signatureBytes");
    const depth = assertInteger(input.controlBlockDepth ?? 0, "controlBlockDepth");

    if (depth > 128) {
      throw new RangeError("controlBlockDepth cannot exceed 128");
    }

    const extra = input.stackElementBytes ?? [];
    const items = signatures + extra.length + 2;
    const witness =
      compactSizeBytes(items) +
      signatures * (compactSizeBytes(signatureBytes) + signatureBytes) +
      extra.reduce(
        (sum, bytes) =>
          sum +
          compactSizeBytes(assertInteger(bytes, "stack element bytes")) +
          assertInteger(bytes, "stack element bytes"),
        0,
      ) +
      compactSizeBytes(scriptBytes) +
      scriptBytes +
      compactSizeBytes(33 + 32 * depth) +
      33 +
      32 * depth;

    return 41 * 4 + witness;
  }

  const { type, m, n, signatureBytes } = validateMultisig(input);
  const scriptBytes = multisigScriptBytes(n);

  if (type === "p2sh-multisig") {
    const scriptSig =
      1 +
      m * (pushDataPrefixBytes(signatureBytes) + signatureBytes) +
      pushDataPrefixBytes(scriptBytes) +
      scriptBytes;

    return (32 + 4 + compactSizeBytes(scriptSig) + scriptSig + 4) * 4;
  }

  const witness =
    compactSizeBytes(m + 2) +
    1 +
    m * (compactSizeBytes(signatureBytes) + signatureBytes) +
    compactSizeBytes(scriptBytes) +
    scriptBytes;
  const nestedScriptSig = type === "p2sh-p2wsh-multisig" ? 35 : 0;

  return (32 + 4 + compactSizeBytes(nestedScriptSig) + nestedScriptSig + 4) * 4 + witness;
}

/** Return serialized output weight in weight units. */
export function outputWeight(output: OutputType): Weight {
  if (typeof output === "string") {
    const bytes: Record<typeof output, number> = {
      p2pk: 44,
      p2pkh: 34,
      p2sh: 32,
      p2wpkh: 31,
      p2wsh: 43,
      p2tr: 43,
      p2a: 13,
    };

    return bytes[output] * 4;
  }

  const scriptBytes = assertInteger(output.scriptPubKeyBytes, "scriptPubKeyBytes");

  return (8 + compactSizeBytes(scriptBytes) + scriptBytes) * 4;
}

/** Round weight up to virtual bytes. */
export function weightToVBytes(weight: Weight): number {
  return Math.ceil(assertInteger(weight, "weight") / 4);
}

interface Decimal {
  numerator: bigint;
  denominator: bigint;
}

function decimalRatio(value: number): Decimal {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("fee rate must be a finite non-negative number");
  }

  const text = value.toString().toLowerCase();
  const [coefficient = "0", exponentText] = text.split("e");
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  const [whole = "0", fraction = ""] = coefficient.split(".");
  const digits = `${whole}${fraction}`;
  const scale = fraction.length - exponent;

  if (scale <= 0) {
    return { numerator: BigInt(digits) * 10n ** BigInt(-scale), denominator: 1n };
  }

  return { numerator: BigInt(digits), denominator: 10n ** BigInt(scale) };
}

/** Calculate `ceil(weight / 4 * feeRate)` without floating-point amount math. */
export function feeForWeight(weight: Weight, feeRate: number): bigint {
  const { numerator, denominator } = decimalRatio(feeRate);
  const scaled = BigInt(assertInteger(weight, "weight")) * numerator;
  const divisor = 4n * denominator;

  return (scaled + divisor - 1n) / divisor;
}

/** Bitcoin Core-style dust threshold for a future spendable output. */
export function dustThresholdFor(output: Weight, spend: Weight, dustRelayFeeRate = 3): bigint {
  return feeForWeight(output + spend, dustRelayFeeRate);
}

export function resolveDustThreshold(policy: ChangePolicy): bigint {
  return (
    policy.dustThreshold ??
    dustThresholdFor(policy.outputWeight, policy.spendWeight, policy.dustRelayFeeRate ?? 3)
  );
}
