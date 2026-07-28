/** BIP-32 derivation index, 0 to 2^31-1 inclusive (the hardened flag is tracked separately). */
export interface PathStep {
  readonly index: number;
  readonly hardened: boolean;
}

/** A BIP-389 multipath element, e.g. the `<0;1>` in `.../0/<0;1>/*`. */
export interface MultipathElement {
  readonly kind: "multipath";
  readonly values: readonly PathStep[];
}

export type PathElement = ({ readonly kind: "step" } & PathStep) | MultipathElement;

export interface KeyOrigin {
  /** 8 lowercase hex characters. */
  readonly fingerprint: string;
  readonly path: readonly PathStep[];
}

export type KeyMaterialKind =
  | "hex-compressed"
  | "hex-uncompressed"
  | "hex-xonly"
  | "wif-compressed"
  | "wif-uncompressed"
  | "xpub"
  | "xprv";

export interface KeyExpression {
  readonly raw: string;
  readonly kind: KeyMaterialKind;
  readonly origin?: KeyOrigin;
  /** Derivation path applied to the key material, empty for non-extended keys. */
  readonly path: readonly PathElement[];
  /** True when the path ends in `/*` or a hardened variant. */
  readonly isRanged: boolean;
}

/** v1 scope: tapscript leaves are limited to a single `pk()` fragment. */
export interface TapLeafScript {
  readonly kind: "pk";
  readonly key: KeyExpression;
}

export type TapTree =
  | { readonly kind: "leaf"; readonly script: TapLeafScript }
  | { readonly kind: "branch"; readonly left: TapTree; readonly right: TapTree };

export type ScriptNode =
  | { readonly kind: "pk"; readonly key: KeyExpression }
  | { readonly kind: "pkh"; readonly key: KeyExpression }
  | { readonly kind: "wpkh"; readonly key: KeyExpression }
  | { readonly kind: "sh"; readonly inner: ScriptNode }
  | { readonly kind: "wsh"; readonly inner: ScriptNode }
  | {
      readonly kind: "multi";
      readonly threshold: number;
      readonly keys: readonly KeyExpression[];
      readonly sorted: boolean;
    }
  | { readonly kind: "combo"; readonly key: KeyExpression }
  | { readonly kind: "raw"; readonly hex: string }
  | { readonly kind: "addr"; readonly address: string }
  | { readonly kind: "tr"; readonly internalKey: KeyExpression; readonly tree?: TapTree };

export interface ParsedDescriptor {
  readonly script: ScriptNode;
  /** Present only when the input string included a `#checksum` suffix. */
  readonly checksum?: string;
  readonly isRanged: boolean;
}

export type ParseFailureReason =
  | "invalid-character"
  | "invalid-checksum"
  | "unexpected-token"
  | "unknown-function"
  | "invalid-key-expression"
  | "invalid-context"
  | "key-count-exceeded"
  | "unsupported";

export interface ParseFailure {
  readonly ok: false;
  readonly reason: ParseFailureReason;
  readonly message: string;
  /** Character offset into the original string, when known. */
  readonly position?: number;
}

export interface ParseSuccess {
  readonly ok: true;
  readonly descriptor: ParsedDescriptor;
}

export type ParseResult = ParseSuccess | ParseFailure;

export type WeightFailureReason = "opaque-script" | "ambiguous-script-type" | "unsupported";

export interface WeightFailure {
  readonly ok: false;
  readonly reason: WeightFailureReason;
  readonly message: string;
}

export interface WeightSuccess {
  readonly ok: true;
  readonly weight: number;
}

export type WeightResult = WeightSuccess | WeightFailure;
