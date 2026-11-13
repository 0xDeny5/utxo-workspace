import {
  betterResult,
  finalizeSelection,
  fundingCheck,
  selectionTarget,
  sumValues,
  validateRequest,
  withoutChange,
} from "./engine";
import type {
  MatrixStrategy,
  OrderName,
  RandomSource,
  SelectionFailure,
  SelectionRequest,
  SelectionResult,
  SelectionSuccess,
  StrategyName,
  Target,
  Utxo,
} from "./types";
import { outpointKey } from "./types";
import { feeForWeight, relayDustThreshold, resolveDustThreshold } from "./weights";

interface Unit<T> {
  readonly id: string;
  readonly utxos: readonly Utxo<T>[];
  readonly value: bigint;
  readonly weight: number;
  readonly effective: bigint;
  readonly confirmations: number;
  readonly timestamp?: number;
  readonly scriptType: string;
  readonly required: boolean;
}

type MutableUnit<T> = { -readonly [K in keyof Unit<T>]: Unit<T>[K] };

interface Prepared<T> {
  readonly required: readonly Unit<T>[];
  readonly optional: readonly Unit<T>[];
  readonly available: bigint;
}

interface Totals {
  value: bigint;
  weight: number;
  count: number;
  effective: bigint;
}

type DeterministicStrategy =
  | "accumulative"
  | "high-priority-first"
  | "largest-first"
  | "newest-first"
  | "oldest-first"
  | "pruned-fifo"
  | "smallest-first";

const MATRIX_ORDERS: Record<MatrixStrategy, readonly [OrderName, OrderName]> = {
  "exact-biggest/accum-biggest": ["biggest", "biggest"],
  "exact-biggest/accum-smallest": ["biggest", "smallest"],
  "exact-biggest/accum-oldest": ["biggest", "oldest"],
  "exact-biggest/accum-newest": ["biggest", "newest"],
  "exact-smallest/accum-biggest": ["smallest", "biggest"],
  "exact-smallest/accum-smallest": ["smallest", "smallest"],
  "exact-smallest/accum-oldest": ["smallest", "oldest"],
  "exact-smallest/accum-newest": ["smallest", "newest"],
  "exact-oldest/accum-biggest": ["oldest", "biggest"],
  "exact-oldest/accum-smallest": ["oldest", "smallest"],
  "exact-oldest/accum-oldest": ["oldest", "oldest"],
  "exact-oldest/accum-newest": ["oldest", "newest"],
  "exact-newest/accum-biggest": ["newest", "biggest"],
  "exact-newest/accum-smallest": ["newest", "smallest"],
  "exact-newest/accum-oldest": ["newest", "oldest"],
  "exact-newest/accum-newest": ["newest", "newest"],
};
/** Default iteration budget for Branch-and-Bound and CoinGrinder, matching Bitcoin Core. */
const DEFAULT_MAX_ITERATIONS = 100_000;
/** Upper bound on Knapsack passes, matching Bitcoin Core's ApproximateBestSubset. */
const KNAPSACK_MAX_ROUNDS = 1_000;
const DEFAULT_SEED = 0x9e37_79b9;

function createUnit<T>(id: string, utxos: readonly Utxo<T>[], feeRate: number): Unit<T> {
  const value = sumValues(utxos);
  const weight = utxos.reduce((sum, utxo) => sum + utxo.weight, 0);
  const timestamps = utxos
    .map((utxo) => utxo.timestamp)
    .filter((timestamp): timestamp is number => timestamp !== undefined);
  const types = new Set(utxos.map((utxo) => utxo.scriptType ?? "unknown"));
  const scriptType = [...types].join();
  const base: MutableUnit<T> = {
    id,
    utxos,
    value,
    weight,
    effective: value - feeForWeight(weight, feeRate),
    confirmations: Math.max(...utxos.map((utxo) => utxo.confirmations ?? 0)),
    scriptType: types.size === 1 ? scriptType : "mixed",
    required: utxos.some((utxo) => utxo.required === true),
  };

  if (timestamps.length > 0) {
    base.timestamp = Math.min(...timestamps);
  }

  return base;
}

function prepare<TUtxo, TTarget>(request: SelectionRequest<TUtxo, TTarget>): Prepared<TUtxo> {
  const minConfirmations = request.minConfirmations ?? 0;
  const available = request.utxos.filter(
    (utxo) =>
      utxo.excluded !== true &&
      (utxo.required === true || (utxo.confirmations ?? 0) >= minConfirmations),
  );

  let units: Unit<TUtxo>[];

  if (request.avoidPartialSpends === true) {
    const groups = new Map<string, Utxo<TUtxo>[]>();

    for (const utxo of available) {
      const key = utxo.group ?? `utxo:${outpointKey(utxo)}`;
      const group = groups.get(key);

      if (!group) {
        groups.set(key, [utxo]);
      } else {
        group.push(utxo);
      }
    }

    units = [...groups].map(([id, utxos]) => createUnit(id, utxos, request.feeRate));
  } else {
    units = available.map((utxo) => createUnit(outpointKey(utxo), [utxo], request.feeRate));
  }

  return {
    required: units.filter((unit) => unit.required),
    optional: units.filter((unit) => !unit.required),
    available: sumValues(available),
  };
}

function flatten<T>(units: readonly Unit<T>[]): readonly Utxo<T>[] {
  return units.flatMap((unit) => unit.utxos);
}

function isNonEmpty<T>(items: readonly T[]): items is readonly [T, ...T[]] {
  return items.length > 0;
}

function totalsOf<T>(units: readonly Unit<T>[]): Totals {
  const totals: Totals = { value: 0n, weight: 0, count: 0, effective: 0n };

  for (const unit of units) {
    addUnit(totals, unit);
  }

  return totals;
}

function addUnit<T>(totals: Totals, unit: Unit<T>): void {
  totals.value += unit.value;
  totals.weight += unit.weight;
  totals.count += unit.utxos.length;
  totals.effective += unit.effective;
}

/** Suffix sums of effective value: `result[i]` is the total from index `i` to the end. */
function suffixEffective<T>(units: readonly Unit<T>[]): readonly bigint[] {
  const sums = new Array<bigint>(units.length + 1).fill(0n);

  for (let index = units.length - 1; index >= 0; index -= 1) {
    // Safe by construction: 0 <= index < units.length < sums.length.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    sums[index] = sums[index + 1]! + units[index]!.effective;
  }

  return sums;
}

function failure<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
  prepared: Prepared<TUtxo>,
  reason: SelectionFailure["reason"] = "insufficient-funds",
): SelectionFailure {
  return {
    ok: false,
    reason,
    message:
      reason === "search-exhausted"
        ? "the strategy reached its search limit without finding a solution"
        : "available UTXOs cannot cover targets and fees",
    available: prepared.available,
    required: selectionTarget(request),
  };
}

function compareBigint(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function ordered<T>(units: readonly Unit<T>[], order: OrderName): Unit<T>[] {
  return [...units].sort((left, right) => {
    if (order === "biggest") {
      return compareBigint(right.effective, left.effective);
    }

    if (order === "smallest") {
      return compareBigint(left.effective, right.effective);
    }

    const leftTime = left.timestamp;
    const rightTime = right.timestamp;

    if (leftTime !== undefined && rightTime !== undefined && leftTime !== rightTime) {
      return order === "oldest" ? leftTime - rightTime : rightTime - leftTime;
    }

    if (left.confirmations !== right.confirmations) {
      return order === "oldest"
        ? right.confirmations - left.confirmations
        : left.confirmations - right.confirmations;
    }

    return order === "oldest" ? left.id.localeCompare(right.id) : right.id.localeCompare(left.id);
  });
}

function orderForStrategy(strategy: DeterministicStrategy): OrderName {
  switch (strategy) {
    case "accumulative":
    case "high-priority-first":
    case "largest-first":
      return "biggest";
    case "smallest-first":
      return "smallest";
    case "oldest-first":
    case "pruned-fifo":
      return "oldest";
    case "newest-first":
      return "newest";
  }
}

function accumulate<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
  strategy: StrategyName,
  order: OrderName,
  optionalOverride?: readonly Unit<TUtxo>[],
): SelectionResult<TUtxo, TTarget> {
  const prepared = prepare(request);
  const funded = fundingCheck(request);
  const selected = [...prepared.required];
  const totals = totalsOf(selected);

  // Once funded, finalization can only fail on weight, and adding inputs only
  // makes the transaction heavier, so the first funded result is final.
  if (funded(totals.value, totals.weight, totals.count)) {
    return finalizeSelection(request, flatten(selected), strategy);
  }

  let candidates =
    optionalOverride === undefined ? ordered(prepared.optional, order) : [...optionalOverride];

  if (strategy === "pruned-fifo") {
    const floor = request.change === undefined ? 0n : resolveDustThreshold(request.change);

    candidates = candidates.filter((unit) => unit.effective > floor);
  }

  if (strategy === "high-priority-first") {
    candidates.sort((left, right) =>
      compareBigint(
        right.value * BigInt(right.confirmations),
        left.value * BigInt(left.confirmations),
      ),
    );
  }

  for (const unit of candidates) {
    if (unit.effective <= 0n) {
      continue;
    }

    selected.push(unit);
    addUnit(totals, unit);

    if (funded(totals.value, totals.weight, totals.count)) {
      return finalizeSelection(request, flatten(selected), strategy);
    }
  }

  return failure(request, prepared);
}

function changeCost<TUtxo, TTarget>(request: SelectionRequest<TUtxo, TTarget>): bigint {
  if (request.change === undefined) {
    return 0n;
  }

  return (
    feeForWeight(request.change.outputWeight, request.feeRate) +
    feeForWeight(request.change.spendWeight, request.longTermFeeRate ?? request.feeRate)
  );
}

/**
 * Changeless strategies (Blackjack, Branch-and-Bound) select within
 * `[target, target + costOfChange]` and leave the excess to the fee, as
 * Bitcoin Core does: inside that window a change output would cost more than
 * it is worth.
 */
function blackjack<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
  strategy: StrategyName,
  order: OrderName,
): SelectionResult<TUtxo, TTarget> {
  const prepared = prepare(request);
  const changeless = withoutChange(request);
  const selected = [...prepared.required];

  let selectedEffective = totalsOf(selected).effective;

  const target = selectionTarget(request);
  const upper = target + changeCost(request);

  if (selectedEffective >= target && (request.change === undefined || selectedEffective <= upper)) {
    const requiredResult = finalizeSelection(changeless, flatten(selected), strategy);

    if (requiredResult.ok) {
      return requiredResult;
    }
  }

  for (const unit of ordered(prepared.optional, order)) {
    if (unit.effective <= 0n || selectedEffective + unit.effective > upper) {
      continue;
    }

    selected.push(unit);
    selectedEffective += unit.effective;

    if (selectedEffective < target) {
      continue;
    }

    const result = finalizeSelection(changeless, flatten(selected), strategy);

    if (result.ok) {
      return result;
    }
  }

  return failure(request, prepared);
}

function matrix<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
  strategy: MatrixStrategy,
): SelectionResult<TUtxo, TTarget> {
  const [exact, accum] = MATRIX_ORDERS[strategy];
  const exactResult = blackjack(request, strategy, exact);

  return exactResult.ok ? exactResult : accumulate(request, strategy, accum);
}

function randomSeed(): number {
  const values = new Uint32Array(1);
  const crypto = (globalThis as { crypto?: Pick<Crypto, "getRandomValues"> }).crypto;

  if (crypto === undefined) {
    return Math.floor(Math.random() * 0x1_0000_0000);
  }

  crypto.getRandomValues(values);

  // Safe by construction: values has exactly one element.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return values[0]!;
}

/**
 * xorshift32. Omitting `seed` draws one from `crypto.getRandomValues`, so
 * randomized strategies are unpredictable by default, as Single Random Draw's
 * privacy goal requires; pass a seed for reproducible results. Zero is a fixed
 * point of xorshift, so a zero state is replaced by the default constant.
 */
function seededRandom(seed: number = randomSeed()): RandomSource {
  let state = seed >>> 0 || DEFAULT_SEED;

  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;

    return (state >>> 0) / 0x1_0000_0000;
  };
}

function shuffled<T>(items: readonly T[], random: RandomSource): T[] {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const value = copy[index];

    copy[index] = copy[swapIndex] as T;
    copy[swapIndex] = value as T;
  }

  return copy;
}

function isEquivalent<T>(left: Unit<T>, right: Unit<T>): boolean {
  return left.effective === right.effective && left.weight === right.weight;
}

function branchAndBound<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
): SelectionResult<TUtxo, TTarget> {
  const strategy: StrategyName = request.strategy === "bnb" ? "bnb" : "branch-and-bound";
  const prepared = prepare(request);
  const candidates = ordered(
    prepared.optional.filter((unit) => unit.effective > 0n),
    "biggest",
  );
  const remaining = suffixEffective(candidates);
  const changeless = withoutChange(request);
  const selected = [...prepared.required];

  let selectedEffective = totalsOf(selected).effective;

  const target = selectionTarget(request);
  const upper = target + changeCost(request);
  const maxIterations = request.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  let iterations = 0;
  let best: SelectionSuccess<TUtxo, TTarget> | undefined;

  // Depth-first search. Inclusion recurses and exclusion continues the loop,
  // so recursion depth is bounded by the number of selected inputs.
  const visit = (start: number): void => {
    let previousExcluded = false;

    for (let index = start; ; index += 1) {
      if (iterations >= maxIterations) {
        return;
      }

      iterations += 1;

      if (selectedEffective >= target) {
        if (selectedEffective <= upper) {
          const result = finalizeSelection(changeless, flatten(selected), strategy);

          if (result.ok) {
            best = betterResult(best, result);
          }
        }

        return;
      }

      const candidate = candidates[index];

      // Safe by construction: a defined candidate implies index < remaining.length - 1.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      if (candidate === undefined || selectedEffective + remaining[index]! < target) {
        return;
      }

      // Bitcoin Core's clone skip: including a candidate right after excluding
      // an equivalent one repeats a branch that has already been searched.
      // Safe by construction: previousExcluded implies index > start >= 0.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      if (!previousExcluded || !isEquivalent(candidates[index - 1]!, candidate)) {
        selected.push(candidate);
        selectedEffective += candidate.effective;

        visit(index + 1);

        selectedEffective -= candidate.effective;
        selected.pop();
      }

      previousExcluded = true;
    }
  };

  visit(0);

  const reason = iterations >= maxIterations ? "search-exhausted" : "insufficient-funds";

  return best ?? failure(request, prepared, reason);
}

function coinGrinder<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
): SelectionResult<TUtxo, TTarget> {
  const prepared = prepare(request);
  const candidates = ordered(
    prepared.optional.filter((unit) => unit.effective > 0n),
    "biggest",
  );
  const remaining = suffixEffective(candidates);
  const selected = [...prepared.required];
  const totals = totalsOf(selected);

  let selectedEffective = totals.effective;
  let selectedWeight = totals.weight;

  const target = selectionTarget(request);
  const maxIterations = request.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  let iterations = 0;
  let bestWeight = Number.POSITIVE_INFINITY;
  let best: SelectionSuccess<TUtxo, TTarget> | undefined;

  const visit = (start: number): void => {
    for (let index = start; ; index += 1) {
      if (iterations >= maxIterations) {
        return;
      }

      iterations += 1;

      if (selectedWeight >= bestWeight) {
        return;
      }

      if (selectedEffective >= target) {
        const result = finalizeSelection(request, flatten(selected), "coingrinder");

        if (result.ok) {
          bestWeight = selectedWeight;
          best = result;
        }

        return;
      }

      const candidate = candidates[index];

      // Safe by construction: a defined candidate implies index < remaining.length - 1.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      if (candidate === undefined || selectedEffective + remaining[index]! < target) {
        return;
      }

      selected.push(candidate);
      selectedEffective += candidate.effective;
      selectedWeight += candidate.weight;

      visit(index + 1);

      selectedWeight -= candidate.weight;
      selectedEffective -= candidate.effective;
      selected.pop();
    }
  };

  visit(0);

  const reason = iterations >= maxIterations ? "search-exhausted" : "insufficient-funds";

  return best ?? failure(request, prepared, reason);
}

function singleRandomDraw<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
): SelectionResult<TUtxo, TTarget> {
  const prepared = prepare(request);

  return accumulate(
    request,
    request.strategy === "srd" ? "srd" : "single-random-draw",
    "biggest",
    shuffled(prepared.optional, seededRandom(request.seed)),
  );
}

function knapsack<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
): SelectionResult<TUtxo, TTarget> {
  const prepared = prepare(request);
  const candidates = prepared.optional.filter((unit) => unit.effective > 0n);
  const funded = fundingCheck(request);
  const required = totalsOf(prepared.required);
  const random = seededRandom(request.seed);
  const rounds = Math.min(request.maxIterations ?? KNAPSACK_MAX_ROUNDS, KNAPSACK_MAX_ROUNDS);

  let best: SelectionSuccess<TUtxo, TTarget> | undefined;

  for (let round = 0; round < rounds; round += 1) {
    const selected = [...prepared.required];
    const totals = { ...required };

    for (const candidate of shuffled(candidates, random)) {
      if (random() >= 0.5) {
        continue;
      }

      selected.push(candidate);
      addUnit(totals, candidate);

      if (!funded(totals.value, totals.weight, totals.count)) {
        continue;
      }

      const result = finalizeSelection(request, flatten(selected), "knapsack");

      if (result.ok) {
        best = betterResult(best, result);
      }

      break;
    }
  }

  const fallback = accumulate(request, "knapsack", "biggest");

  if (fallback.ok) {
    return betterResult(best, fallback);
  }

  // The fallback's failure carries the precise reason (for example max weight).
  return best ?? fallback;
}

function selectSplit<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
): SelectionResult<TUtxo, TTarget> {
  const prepared = prepare(request);
  const units = [...prepared.required, ...prepared.optional].filter(
    (unit) => unit.required || unit.effective > 0n,
  );
  const inputs = flatten(units);
  const openTarget = request.targets.find((target) => target.value === undefined);

  if (openTarget === undefined) {
    return failure(request, prepared);
  }

  const fixedValue = request.targets.reduce((sum, target) => sum + (target.value ?? 0n), 0n);
  const changeless = withoutChange(request);
  const baseResult = finalizeSelection(
    changeless,
    inputs,
    "split",
    request.targets.map(() => 0n),
  );

  if (!baseResult.ok) {
    return baseResult;
  }

  const fee = feeForWeight(baseResult.weight, request.feeRate);
  const openValue = sumValues(inputs) - fixedValue - fee;
  const dust = relayDustThreshold(openTarget.weight, request.change?.dustRelayFeeRate ?? 3);

  if (openValue < dust) {
    return {
      ...failure(request, prepared),
      message: `the send-all output would be ${String(openValue)} sats, below its ${String(dust)} sat dust threshold`,
    };
  }

  const values = request.targets.map((target) => target.value ?? openValue);

  return finalizeSelection(changeless, inputs, "split", values);
}

function selectBreak<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
): SelectionResult<TUtxo, TTarget> {
  const [template] = request.targets;
  const denomination = template.value;

  if (denomination === undefined || denomination <= 0n) {
    return {
      ok: false,
      reason: "invalid-request",
      message: "break requires a positive first target denomination",
    };
  }

  const prepared = prepare(request);
  const inputs = flatten([...prepared.required, ...prepared.optional]);
  const outputs: Target<TTarget>[] = [];

  while (outputs.length < 10_000) {
    const candidate =
      template.meta === undefined
        ? { value: denomination, weight: template.weight }
        : { value: denomination, weight: template.weight, meta: template.meta };
    const next: [Target<TTarget>, ...Target<TTarget>[]] = [candidate, ...outputs];
    const trialRequest = { ...request, targets: next, strategy: "break" as const };
    const trial = finalizeSelection(trialRequest, inputs, "break");

    if (!trial.ok || next.length * template.weight > (request.maxWeight ?? 400_000)) {
      break;
    }

    outputs.push(candidate);
  }

  if (!isNonEmpty(outputs)) {
    return failure(request, prepared);
  }

  const finalRequest = { ...request, targets: outputs, strategy: "break" as const };

  return finalizeSelection(finalRequest, inputs, "break");
}

function isMatrixStrategy(strategy: StrategyName): strategy is MatrixStrategy {
  return strategy.startsWith("exact-");
}

function dispatch<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
): SelectionResult<TUtxo, TTarget> {
  const strategy = request.strategy ?? "best";

  if (isMatrixStrategy(strategy)) {
    return matrix(request, strategy);
  }

  switch (strategy) {
    case "best":
      return best(request);
    case "branch-and-bound":
    case "bnb":
      return branchAndBound(request);
    case "coingrinder":
      return coinGrinder(request);
    case "single-random-draw":
    case "srd":
      return singleRandomDraw(request);
    case "knapsack":
      return knapsack(request);
    case "blackjack":
      return blackjack(request, "blackjack", "biggest");
    case "split":
      return selectSplit(request);
    case "break":
      return selectBreak(request);
    case "accumulative":
    case "largest-first":
    case "smallest-first":
    case "oldest-first":
    case "newest-first":
    case "pruned-fifo":
    case "high-priority-first":
      return accumulate(request, strategy, orderForStrategy(strategy));
  }
}

/** When every strategy fails, the most specific reason wins: it tells the caller what to change. */
const FAILURE_PRIORITY: Record<SelectionFailure["reason"], number> = {
  "invalid-request": 3,
  "max-weight-exceeded": 2,
  "search-exhausted": 1,
  "insufficient-funds": 0,
};

function best<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
): SelectionResult<TUtxo, TTarget> {
  const longTerm = request.longTermFeeRate ?? request.feeRate;
  const strategies: StrategyName[] = [
    "branch-and-bound",
    "knapsack",
    "single-random-draw",
    "largest-first",
    "smallest-first",
    "oldest-first",
    "blackjack",
  ];

  if (request.feeRate > longTerm * 3) {
    strategies.push("coingrinder");
  }

  let winner: SelectionSuccess<TUtxo, TTarget> | undefined;
  let bestFailure: SelectionFailure | undefined;

  for (const strategy of strategies) {
    const result = dispatch({ ...request, strategy, preferSingleScriptType: false });

    if (result.ok) {
      winner = betterResult(winner, result);
    } else if (
      bestFailure === undefined ||
      FAILURE_PRIORITY[result.reason] > FAILURE_PRIORITY[bestFailure.reason]
    ) {
      bestFailure = result;
    }
  }

  // Safe by construction: the shortlist is non-empty, so without a winner at
  // least one failure was recorded.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return winner ?? bestFailure!;
}

function withSingleTypePreference<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
): SelectionResult<TUtxo, TTarget> {
  const types = new Set(
    request.utxos
      .filter((utxo) => utxo.required !== true)
      .map((utxo) => utxo.scriptType)
      .filter((type): type is string => type !== undefined),
  );

  let winner: SelectionSuccess<TUtxo, TTarget> | undefined;

  for (const type of types) {
    const subset = request.utxos.filter(
      (utxo) => utxo.required === true || utxo.scriptType === type,
    );
    const result = dispatch({
      ...request,
      utxos: subset,
      preferSingleScriptType: false,
    });

    if (result.ok) {
      winner = betterResult(winner, result);
    }
  }

  return winner ?? dispatch({ ...request, preferSingleScriptType: false });
}

/** Select UTXOs using the requested strategy (`best` by default). */
export function selectCoins<TUtxo = unknown, TTarget = unknown>(
  request: SelectionRequest<TUtxo, TTarget>,
): SelectionResult<TUtxo, TTarget> {
  const requestError = validateRequest(request);

  if (requestError !== undefined) {
    return requestError;
  }

  return request.preferSingleScriptType === true
    ? withSingleTypePreference(request)
    : dispatch(request);
}

export function selectAccumulative<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
): SelectionResult<TUtxo, TTarget> {
  return selectCoins({ ...request, strategy: "accumulative" });
}

export function selectBlackjack<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
): SelectionResult<TUtxo, TTarget> {
  return selectCoins({ ...request, strategy: "blackjack" });
}

/** Runs several strategies and returns the lowest-waste success (the `best` strategy). */
export function selectBest<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
): SelectionResult<TUtxo, TTarget> {
  return selectCoins({ ...request, strategy: "best" });
}

/** Branch-and-Bound search for a changeless selection. Keeps the `bnb` alias as the result name. */
export function selectBranchAndBound<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
): SelectionResult<TUtxo, TTarget> {
  return selectCoins({
    ...request,
    strategy: request.strategy === "bnb" ? "bnb" : "branch-and-bound",
  });
}

/** CoinGrinder: the funding selection with the lowest input weight. */
export function selectCoinGrinder<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
): SelectionResult<TUtxo, TTarget> {
  return selectCoins({ ...request, strategy: "coingrinder" });
}

/** Single Random Draw. Keeps the `srd` alias as the result name. */
export function selectSingleRandomDraw<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
): SelectionResult<TUtxo, TTarget> {
  return selectCoins({
    ...request,
    strategy: request.strategy === "srd" ? "srd" : "single-random-draw",
  });
}

/** Randomized subset passes compared with a largest-first fallback. */
export function selectKnapsack<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
): SelectionResult<TUtxo, TTarget> {
  return selectCoins({ ...request, strategy: "knapsack" });
}
