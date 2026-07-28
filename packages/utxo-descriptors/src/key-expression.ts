import { base58Decode } from "./base58";
import type { KeyExpression, KeyMaterialKind, KeyOrigin, PathElement, PathStep } from "./types";

const MAX_INDEX = 2147483647;
const FINGERPRINT_PATTERN = /^[0-9a-fA-F]{8}$/;
const STEP_PATTERN = /^([0-9]+)(h|')?$/;
const EXTENDED_KEY_BYTES = 82;
const WIF_UNCOMPRESSED_BYTES = 37;
const WIF_COMPRESSED_BYTES = 38;
const XPUB_VERSIONS: Readonly<Record<string, number>> = {
  xpub: 0x0488b21e,
  xprv: 0x0488ade4,
  tpub: 0x043587cf,
  tprv: 0x04358394,
};

export interface KeyExpressionFailure {
  readonly ok: false;
  readonly message: string;
}

export interface KeyExpressionSuccess {
  readonly ok: true;
  readonly key: KeyExpression;
}

export type KeyExpressionResult = KeyExpressionSuccess | KeyExpressionFailure;

function fail(message: string): KeyExpressionFailure {
  return { ok: false, message };
}

function parseStep(segment: string): PathStep | undefined {
  const match = STEP_PATTERN.exec(segment);

  if (match === null) {
    return undefined;
  }

  const [, digits, marker] = match;
  const index = Number(digits);

  if (!Number.isSafeInteger(index) || index > MAX_INDEX) {
    return undefined;
  }

  return { index, hardened: marker !== undefined };
}

function parseOrigin(bracketed: string): KeyOrigin | undefined {
  const segments = bracketed.split("/");
  const [fingerprint, ...pathSegments] = segments;

  if (fingerprint === undefined || !FINGERPRINT_PATTERN.test(fingerprint)) {
    return undefined;
  }

  const path: PathStep[] = [];

  for (const segment of pathSegments) {
    const step = parseStep(segment);

    if (step === undefined) {
      return undefined;
    }

    path.push(step);
  }

  return { fingerprint: fingerprint.toLowerCase(), path };
}

interface OriginSplit {
  readonly origin?: KeyOrigin;
  readonly remainder: string;
}

function splitOrigin(text: string): OriginSplit | KeyExpressionFailure {
  if (!text.startsWith("[")) {
    return { remainder: text };
  }

  const closeIndex = text.indexOf("]");

  if (closeIndex === -1) {
    return fail("unterminated key origin: missing ']'");
  }

  const origin = parseOrigin(text.slice(1, closeIndex));

  if (origin === undefined) {
    return fail(
      "invalid key origin: expected an 8-character hex fingerprint and /NUM or /NUMh steps",
    );
  }

  const remainder = text.slice(closeIndex + 1);

  if (remainder.startsWith("[")) {
    return fail("a key expression may only carry one key origin");
  }

  if (remainder.length === 0) {
    return fail("key origin is not followed by a key");
  }

  return { origin, remainder };
}

function parseTrailingPath(
  text: string,
): { readonly path: PathElement[]; readonly isRanged: boolean } | undefined {
  if (text.length === 0) {
    return { path: [], isRanged: false };
  }

  const segments = text.slice(1).split("/");
  const path: PathElement[] = [];

  for (const [index, segment] of segments.entries()) {
    const isLast = index === segments.length - 1;

    if (isLast && /^\*(h|')?$/.test(segment)) {
      return { path, isRanged: true };
    }

    if (segment.startsWith("<") && segment.endsWith(">")) {
      const values = segment
        .slice(1, -1)
        .split(";")
        .map((part) => parseStep(part));

      if (values.length < 2 || values.some((value) => value === undefined)) {
        return undefined;
      }

      const resolved = values as PathStep[];
      const seen = new Set<string>();

      for (const value of resolved) {
        const key = `${String(value.index)}:${String(value.hardened)}`;

        if (seen.has(key)) {
          return undefined;
        }

        seen.add(key);
      }

      path.push({ kind: "multipath", values: resolved });

      continue;
    }

    const step = parseStep(segment);

    if (step === undefined) {
      return undefined;
    }

    path.push({ kind: "step", ...step });
  }

  return { path, isRanged: false };
}

function classifyKeyMaterial(keyBody: string): KeyMaterialKind | undefined {
  if (/^(02|03)[0-9a-fA-F]{64}$/.test(keyBody)) {
    return "hex-compressed";
  }

  if (/^04[0-9a-fA-F]{128}$/.test(keyBody)) {
    return "hex-uncompressed";
  }

  if (/^[0-9a-fA-F]{64}$/.test(keyBody)) {
    return "hex-xonly";
  }

  const extendedPrefix = keyBody.slice(0, 4);

  if (extendedPrefix in XPUB_VERSIONS) {
    const decoded = base58Decode(keyBody);
    const expectedVersion = XPUB_VERSIONS[extendedPrefix];

    if (decoded?.length === EXTENDED_KEY_BYTES && expectedVersion !== undefined) {
      // Safe by construction: decoded.length === EXTENDED_KEY_BYTES (82)
      // guarantees indices 0 through 3 exist.
      /* eslint-disable @typescript-eslint/no-non-null-assertion */
      const version = (decoded[0]! << 24) | (decoded[1]! << 16) | (decoded[2]! << 8) | decoded[3]!;
      /* eslint-enable @typescript-eslint/no-non-null-assertion */

      if (version >>> 0 === expectedVersion >>> 0) {
        return extendedPrefix === "xprv" || extendedPrefix === "tprv" ? "xprv" : "xpub";
      }
    }

    return undefined;
  }

  const decoded = base58Decode(keyBody);

  if (decoded?.length === WIF_COMPRESSED_BYTES) {
    return "wif-compressed";
  }

  if (decoded?.length === WIF_UNCOMPRESSED_BYTES) {
    return "wif-uncompressed";
  }

  return undefined;
}

export interface KeyExpressionOptions {
  /** Bare 64-hex x-only keys (BIP-386) are only valid directly inside tr(). */
  readonly allowXOnly: boolean;
}

export function parseKeyExpression(
  raw: string,
  options: KeyExpressionOptions,
): KeyExpressionResult {
  const split = splitOrigin(raw);

  if ("ok" in split) {
    return split;
  }

  const { origin, remainder } = split;
  const slashIndex = remainder.indexOf("/");
  const keyBody = slashIndex === -1 ? remainder : remainder.slice(0, slashIndex);
  const trailingText = slashIndex === -1 ? "" : remainder.slice(slashIndex);
  const kind = classifyKeyMaterial(keyBody);

  if (kind === undefined) {
    return fail(`unrecognized key material: ${keyBody}`);
  }

  if (kind === "hex-xonly" && !options.allowXOnly) {
    return fail("bare x-only (64 hex character) keys are only valid inside tr()");
  }

  if (kind !== "xpub" && kind !== "xprv" && trailingText.length > 0) {
    return fail("a derivation path is only allowed after an extended (xpub/xprv) key");
  }

  const trailing = parseTrailingPath(trailingText);

  if (trailing === undefined) {
    return fail(`invalid derivation path: ${trailingText}`);
  }

  const key: KeyExpression = {
    raw,
    kind,
    ...(origin !== undefined ? { origin } : {}),
    path: trailing.path,
    isRanged: trailing.isRanged,
  };

  return { ok: true, key };
}
