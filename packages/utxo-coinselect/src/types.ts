/** Satoshis. Amounts use bigint to avoid precision loss. */
export type Satoshis = bigint;

/** Transaction weight units (WU). Four WU equal one virtual byte. */
export type Weight = number;

export type OrderName = "biggest" | "smallest" | "oldest" | "newest";

export type MatrixStrategy = `exact-${OrderName}/accum-${OrderName}`;

type NamedStrategy =
  | "best"
  | "accumulative"
  | "blackjack"
  | "largest-first"
  | "smallest-first"
  | "oldest-first"
  | "newest-first"
  | "pruned-fifo"
  | "high-priority-first"
  | "branch-and-bound"
  | "bnb"
  | "coingrinder"
  | "single-random-draw"
  | "srd"
  | "knapsack"
  | "break"
  | "split";

/** All accepted strategy names, suitable for validation and UI option lists. */
export const STRATEGY_NAMES = [
  "best",
  "accumulative",
  "blackjack",
  "largest-first",
  "smallest-first",
  "oldest-first",
  "newest-first",
  "pruned-fifo",
  "high-priority-first",
  "branch-and-bound",
  "bnb",
  "coingrinder",
  "single-random-draw",
  "srd",
  "knapsack",
  "break",
  "split",
  "exact-biggest/accum-biggest",
  "exact-biggest/accum-smallest",
  "exact-biggest/accum-oldest",
  "exact-biggest/accum-newest",
  "exact-smallest/accum-biggest",
  "exact-smallest/accum-smallest",
  "exact-smallest/accum-oldest",
  "exact-smallest/accum-newest",
  "exact-oldest/accum-biggest",
  "exact-oldest/accum-smallest",
  "exact-oldest/accum-oldest",
  "exact-oldest/accum-newest",
  "exact-newest/accum-biggest",
  "exact-newest/accum-smallest",
  "exact-newest/accum-oldest",
  "exact-newest/accum-newest",
] as const satisfies readonly (NamedStrategy | MatrixStrategy)[];

type MissingStrategyCatalogEntries = Exclude<
  NamedStrategy | MatrixStrategy,
  (typeof STRATEGY_NAMES)[number]
>;

/** Compile-time proof that STRATEGY_NAMES lists every StrategyName variant. */
export const STRATEGY_CATALOG_COMPLETE: [MissingStrategyCatalogEntries] extends [never]
  ? true
  : never = true;

export type StrategyName = (typeof STRATEGY_NAMES)[number];

/**
 * A spendable output candidate.
 *
 * `weight` is the complete input weight excluding the transaction-level input
 * count. Use the helpers exported from `utxo-coinselect/weights`.
 */
export interface Utxo<T = unknown> {
  /** Transaction id that created this output (usually 64-char hex). */
  readonly txid: string;
  /** Zero-based output index within that transaction. */
  readonly vout: number;
  readonly value: Satoshis;
  readonly weight: Weight;
  readonly confirmations?: number;
  /** Unix timestamp or another monotonically increasing creation order. */
  readonly timestamp?: number;
  /** UTXOs in the same group are selected atomically with avoidPartialSpends. */
  readonly group?: string;
  /** Used by preferSingleScriptType. */
  readonly scriptType?: string;
  readonly required?: boolean;
  readonly excluded?: boolean;
  readonly meta?: T;
}

export function outpointKey(utxo: Pick<Utxo, "txid" | "vout">): string {
  return `${utxo.txid}:${String(utxo.vout)}`;
}

/** A requested transaction output. Omit value only for split/send-all. */
export interface Target<T = unknown> {
  readonly value?: Satoshis;
  readonly weight: Weight;
  readonly meta?: T;
}

export interface ChangePolicy {
  readonly outputWeight: Weight;
  /** Estimated weight to spend the future change output. */
  readonly spendWeight: Weight;
  /** Explicit dust floor. When omitted it is derived from dustRelayFeeRate. */
  readonly dustThreshold?: Satoshis;
  /** Defaults to 3 sat/vB, matching Bitcoin Core's dust relay convention. */
  readonly dustRelayFeeRate?: number;
}

export interface SelectionRequest<TUtxo = unknown, TTarget = unknown> {
  readonly utxos: readonly Utxo<TUtxo>[];
  readonly targets: readonly [Target<TTarget>, ...Target<TTarget>[]];
  readonly feeRate: number;
  readonly longTermFeeRate?: number;
  readonly strategy?: StrategyName;
  readonly change?: ChangePolicy;
  /** Transaction-level fixed weight excluding input/output CompactSize fields. */
  readonly baseWeight?: Weight;
  readonly maxWeight?: Weight;
  readonly maxIterations?: number;
  readonly seed?: number;
  readonly minConfirmations?: number;
  readonly avoidPartialSpends?: boolean;
  readonly preferSingleScriptType?: boolean;
}

export interface SelectedOutput<T = unknown> {
  readonly value: Satoshis;
  readonly weight: Weight;
  readonly isChange: boolean;
  readonly meta?: T;
}

export interface SelectionSuccess<TUtxo = unknown, TTarget = unknown> {
  readonly ok: true;
  readonly inputs: readonly Utxo<TUtxo>[];
  readonly outputs: readonly SelectedOutput<TTarget>[];
  readonly fee: Satoshis;
  readonly change: Satoshis;
  readonly waste: Satoshis;
  readonly weight: Weight;
  readonly strategy: StrategyName;
}

export type SelectionFailureReason =
  "insufficient-funds" | "invalid-request" | "search-exhausted" | "max-weight-exceeded";

export interface SelectionFailure {
  readonly ok: false;
  readonly reason: SelectionFailureReason;
  readonly message: string;
  readonly available?: Satoshis;
  readonly required?: Satoshis;
}

export type SelectionResult<TUtxo = unknown, TTarget = unknown> =
  SelectionSuccess<TUtxo, TTarget> | SelectionFailure;

/** Injectable random source. Values must be in [0, 1). */
export type RandomSource = () => number;
