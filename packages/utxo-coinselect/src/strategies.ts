import {
  betterResult,
  finalizeSelection,
  selectionTarget,
  sumValues,
  validateRequest,
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
import { feeForWeight, resolveDustThreshold } from "./weights";

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
  const selected = [...prepared.required];
  const requiredResult = finalizeSelection(request, flatten(selected), strategy);

  if (requiredResult.ok) {
    return requiredResult;
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
    const result = finalizeSelection(request, flatten(selected), strategy);

    if (result.ok) {
      return result;
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

function blackjack<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
  strategy: StrategyName,
  order: OrderName,
): SelectionResult<TUtxo, TTarget> {
  const prepared = prepare(request);
  const selected = [...prepared.required];

  let selectedEffective = selected.reduce((sum, unit) => sum + unit.effective, 0n);

  const target = selectionTarget(request);
  const upper = target + changeCost(request);
  const requiredResult = finalizeSelection(request, flatten(selected), strategy);

  if (requiredResult.ok && requiredResult.change === 0n) {
    return requiredResult;
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

    const result = finalizeSelection(request, flatten(selected), strategy);

    if (result.ok && result.change === 0n) {
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

function seededRandom(seed = 0x9e37_79b9): RandomSource {
  let state = seed >>> 0;

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

export function selectBranchAndBound<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
): SelectionResult<TUtxo, TTarget> {
  const strategy: StrategyName = request.strategy === "bnb" ? "bnb" : "branch-and-bound";
  const prepared = prepare(request);
  const candidates = ordered(
    prepared.optional.filter((unit) => unit.effective > 0n),
    "biggest",
  );
  const selected = [...prepared.required];

  let selectedEffective = selected.reduce((sum, unit) => sum + unit.effective, 0n);

  const target = selectionTarget(request);
  const upper = target + changeCost(request);
  const availableEffective = candidates.reduce((sum, candidate) => sum + candidate.effective, 0n);
  const maxIterations = request.maxIterations ?? 100_000;

  let iterations = 0;
  let best: SelectionSuccess<TUtxo, TTarget> | undefined;

  const visit = (
    remaining: readonly Unit<TUtxo>[],
    remainingEffective: bigint,
    previous?: Unit<TUtxo>,
  ): void => {
    if (iterations >= maxIterations) {
      return;
    }

    iterations += 1;

    if (selectedEffective >= target) {
      if (selectedEffective <= upper) {
        const result = finalizeSelection(request, flatten(selected), strategy);

        if (result.ok && result.change === 0n) {
          best = betterResult(best, result);
        }
      }

      return;
    }

    const [candidate, ...rest] = remaining;

    if (candidate === undefined) {
      return;
    }

    if (selectedEffective + remainingEffective < target) {
      return;
    }

    const nextRemainingEffective = remainingEffective - candidate.effective;

    selected.push(candidate);
    selectedEffective += candidate.effective;

    visit(rest, nextRemainingEffective, candidate);

    selectedEffective -= candidate.effective;
    selected.pop();

    if (previous?.effective !== candidate.effective || previous.weight !== candidate.weight) {
      visit(rest, nextRemainingEffective, candidate);
    }
  };

  visit(candidates, availableEffective);

  const reason = iterations >= maxIterations ? "search-exhausted" : "insufficient-funds";

  return best ?? failure(request, prepared, reason);
}

export function selectCoinGrinder<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
): SelectionResult<TUtxo, TTarget> {
  const prepared = prepare(request);
  const candidates = ordered(
    prepared.optional.filter((unit) => unit.effective > 0n),
    "biggest",
  );
  const availableEffective = candidates.reduce((sum, candidate) => sum + candidate.effective, 0n);
  const selected = [...prepared.required];

  let selectedEffective = selected.reduce((sum, unit) => sum + unit.effective, 0n);
  let selectedWeight = selected.reduce((sum, unit) => sum + unit.weight, 0);

  const target = selectionTarget(request);
  const maxIterations = request.maxIterations ?? 100_000;

  let iterations = 0;
  let bestWeight = Number.POSITIVE_INFINITY;
  let best: SelectionSuccess<TUtxo, TTarget> | undefined;

  const visit = (remaining: readonly Unit<TUtxo>[], remainingEffective: bigint): void => {
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

    const [candidate, ...rest] = remaining;

    if (!candidate) {
      return;
    }

    if (selectedEffective + remainingEffective < target) {
      return;
    }

    const nextRemainingEffective = remainingEffective - candidate.effective;

    selected.push(candidate);
    selectedEffective += candidate.effective;
    selectedWeight += candidate.weight;

    visit(rest, nextRemainingEffective);

    selectedWeight -= candidate.weight;
    selectedEffective -= candidate.effective;
    selected.pop();

    visit(rest, nextRemainingEffective);
  };

  visit(candidates, availableEffective);

  const reason = iterations >= maxIterations ? "search-exhausted" : "insufficient-funds";

  return best ?? failure(request, prepared, reason);
}

export function selectSingleRandomDraw<TUtxo, TTarget>(
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

export function selectKnapsack<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
): SelectionResult<TUtxo, TTarget> {
  const prepared = prepare(request);
  const candidates = prepared.optional.filter((unit) => unit.effective > 0n);
  const random = seededRandom(request.seed);
  const rounds = Math.min(request.maxIterations ?? 1_000, 100_000);

  let best: SelectionSuccess<TUtxo, TTarget> | undefined;

  for (let round = 0; round < rounds; round += 1) {
    const selected = [...prepared.required];

    for (const candidate of shuffled(candidates, random)) {
      if (random() < 0.5) {
        selected.push(candidate);
      }

      const result = finalizeSelection(request, flatten(selected), "knapsack");

      if (result.ok) {
        best = betterResult(best, result);
        break;
      }
    }
  }

  const fallback = accumulate(request, "knapsack", "biggest");

  if (fallback.ok) {
    best = betterResult(best, fallback);
  }

  return best ?? failure(request, prepared);
}

function selectSplit<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
): SelectionResult<TUtxo, TTarget> {
  const prepared = prepare(request);
  const units = [...prepared.required, ...prepared.optional].filter(
    (unit) => unit.required || unit.effective > 0n,
  );
  const inputs = flatten(units);
  const openIndex = request.targets.findIndex((target) => target.value === undefined);

  if (openIndex < 0) {
    return failure(request, prepared);
  }

  const fixedValue = request.targets.reduce((sum, target) => sum + (target.value ?? 0n), 0n);
  const { change: _change, ...withoutChange } = request;
  const baseResult = finalizeSelection(
    withoutChange,
    inputs,
    "split",
    request.targets.map(() => 0n),
  );

  if (!baseResult.ok) {
    return baseResult;
  }

  const fee = feeForWeight(baseResult.weight, request.feeRate);
  const openValue = sumValues(inputs) - fixedValue - fee;

  if (openValue < 0n) {
    return failure(request, prepared);
  }

  const values = request.targets.map((target) => target.value ?? openValue);

  return finalizeSelection(withoutChange, inputs, "split", values);
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
      return selectBest(request);
    case "branch-and-bound":
    case "bnb":
      return selectBranchAndBound(request);
    case "coingrinder":
      return selectCoinGrinder(request);
    case "single-random-draw":
    case "srd":
      return selectSingleRandomDraw(request);
    case "knapsack":
      return selectKnapsack(request);
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

export function selectBest<TUtxo, TTarget>(
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

  let best: SelectionSuccess<TUtxo, TTarget> | undefined;
  let lastFailure: SelectionFailure = {
    ok: false,
    reason: "insufficient-funds",
    message: "no eligible strategy found a solution",
  };

  for (const strategy of strategies) {
    const result = dispatch({ ...request, strategy, preferSingleScriptType: false });

    if (result.ok) {
      best = betterResult(best, result);
    } else {
      lastFailure = result;
    }
  }

  return best ?? lastFailure;
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

  let best: SelectionSuccess<TUtxo, TTarget> | undefined;

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
      best = betterResult(best, result);
    }
  }

  return best ?? dispatch({ ...request, preferSingleScriptType: false });
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
