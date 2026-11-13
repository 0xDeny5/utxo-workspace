import type {
  ChangePolicy,
  SelectedOutput,
  SelectionFailure,
  SelectionRequest,
  SelectionResult,
  SelectionSuccess,
  StrategyName,
  Target,
  Utxo,
  Weight,
} from "./types";
import { outpointKey, STRATEGY_NAMES } from "./types";
import { compactSizeBytes, feeForWeight, resolveDustThreshold } from "./weights";

export const DEFAULT_BASE_WEIGHT = 34;
export const DEFAULT_MAX_WEIGHT = 400_000;

const STRATEGIES = new Set<StrategyName>(STRATEGY_NAMES);

export function invalid(message: string): SelectionFailure {
  return { ok: false, reason: "invalid-request", message };
}

export function validateRequest<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
): SelectionFailure | undefined {
  if (!Number.isFinite(request.feeRate) || request.feeRate < 0) {
    return invalid("feeRate must be a finite non-negative number");
  }

  if (
    request.longTermFeeRate !== undefined &&
    (!Number.isFinite(request.longTermFeeRate) || request.longTermFeeRate < 0)
  ) {
    return invalid("longTermFeeRate must be a finite non-negative number");
  }

  if (request.strategy !== undefined && !STRATEGIES.has(request.strategy)) {
    return invalid(`unknown strategy: ${request.strategy}`);
  }

  if (request.targets.length === 0) {
    return invalid("at least one target is required");
  }

  const hasOpenTarget = request.targets.some((target) => target.value === undefined);

  if (hasOpenTarget && request.strategy !== "split") {
    return invalid("targets without values are only supported by the split strategy");
  }

  if (request.targets.filter((target) => target.value === undefined).length > 1) {
    return invalid("split supports exactly one target without a value");
  }

  for (const target of request.targets) {
    if (target.value !== undefined && typeof target.value !== "bigint") {
      return invalid("target values must be bigint satoshis (for example 1_000n)");
    }

    if ((target.value ?? 0n) < 0n) {
      return invalid("target values cannot be negative");
    }

    if (!Number.isSafeInteger(target.weight) || target.weight < 0) {
      return invalid("target weights must be non-negative safe integers");
    }
  }

  const outpoints = new Set<string>();

  for (const utxo of request.utxos) {
    if (typeof utxo.txid !== "string" || utxo.txid.length === 0) {
      return invalid("UTXO txid must be a non-empty string");
    }

    if (!Number.isSafeInteger(utxo.vout) || utxo.vout < 0) {
      return invalid(`UTXO ${utxo.txid} has an invalid vout`);
    }

    const key = outpointKey(utxo);

    if (outpoints.has(key)) {
      return invalid(`duplicate UTXO outpoint: ${key}`);
    }

    outpoints.add(key);

    if (typeof utxo.value !== "bigint") {
      return invalid(`UTXO ${key} value must be bigint satoshis (for example 1_000n)`);
    }

    if (utxo.value < 0n) {
      return invalid(`UTXO ${key} has a negative value`);
    }

    if (!Number.isSafeInteger(utxo.weight) || utxo.weight < 0) {
      return invalid(`UTXO ${key} has an invalid weight`);
    }
  }

  return validateOptions(request);
}

function isNonNegativeSafeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validateOptions<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
): SelectionFailure | undefined {
  const { change } = request;

  if (change !== undefined) {
    if (!isNonNegativeSafeInteger(change.outputWeight)) {
      return invalid("change.outputWeight must be a non-negative safe integer");
    }

    if (!isNonNegativeSafeInteger(change.spendWeight)) {
      return invalid("change.spendWeight must be a non-negative safe integer");
    }

    if (
      change.dustThreshold !== undefined &&
      (typeof change.dustThreshold !== "bigint" || change.dustThreshold < 0n)
    ) {
      return invalid("change.dustThreshold must be a non-negative bigint");
    }

    if (
      change.dustRelayFeeRate !== undefined &&
      (!Number.isFinite(change.dustRelayFeeRate) || change.dustRelayFeeRate < 0)
    ) {
      return invalid("change.dustRelayFeeRate must be a finite non-negative number");
    }
  }

  for (const [name, value] of [
    ["baseWeight", request.baseWeight],
    ["maxWeight", request.maxWeight],
    ["maxIterations", request.maxIterations],
    ["minConfirmations", request.minConfirmations],
  ] as const) {
    if (value !== undefined && !isNonNegativeSafeInteger(value)) {
      return invalid(`${name} must be a non-negative safe integer`);
    }
  }

  if (request.seed !== undefined && !Number.isSafeInteger(request.seed)) {
    return invalid("seed must be a safe integer");
  }

  return undefined;
}

export function targetValue<T>(targets: readonly Target<T>[]): bigint {
  return targets.reduce((sum, target) => sum + (target.value ?? 0n), 0n);
}

export function sumValues<T>(utxos: readonly Utxo<T>[]): bigint {
  return utxos.reduce((sum, utxo) => sum + utxo.value, 0n);
}

export function sumWeights<T>(utxos: readonly Utxo<T>[]): Weight {
  return utxos.reduce((sum, utxo) => sum + utxo.weight, 0);
}

export function transactionWeight<TUtxo, TTarget>(
  inputs: readonly Utxo<TUtxo>[],
  outputs: readonly Target<TTarget>[] | readonly SelectedOutput<TTarget>[],
  baseWeight = DEFAULT_BASE_WEIGHT,
): Weight {
  return (
    baseWeight +
    compactSizeBytes(inputs.length) * 4 +
    compactSizeBytes(outputs.length) * 4 +
    sumWeights(inputs) +
    outputs.reduce((sum, output) => sum + output.weight, 0)
  );
}

/**
 * Smallest change output worth creating: at least the dust threshold, and more
 * than it will cost to spend later at the long-term fee rate. Mirrors Bitcoin
 * Core's `min_viable_change`; a smaller remainder is left to the miner fee.
 */
export function minimumChange<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
  policy: ChangePolicy,
): bigint {
  const dust = resolveDustThreshold(policy);
  const spendCost =
    feeForWeight(policy.spendWeight, request.longTermFeeRate ?? request.feeRate) + 1n;

  return dust > spendCost ? dust : spendCost;
}

/** The request with its change policy removed, for strategies that only build changeless transactions. */
export function withoutChange<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
): SelectionRequest<TUtxo, TTarget> {
  const { change: _change, ...changeless } = request;

  return changeless;
}

/**
 * Cheap necessary condition for {@link finalizeSelection} to succeed: the
 * inputs cover targets plus the changeless fee. Lets accumulating strategies
 * track running totals instead of re-finalizing after every candidate.
 */
export function fundingCheck<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
): (value: bigint, weight: Weight, count: number) => boolean {
  const required = targetValue(request.targets);
  const outputsWeight =
    (request.baseWeight ?? DEFAULT_BASE_WEIGHT) +
    compactSizeBytes(request.targets.length) * 4 +
    request.targets.reduce((sum, target) => sum + target.weight, 0);

  return (value, weight, count) =>
    value - required >=
    feeForWeight(outputsWeight + compactSizeBytes(count) * 4 + weight, request.feeRate);
}

export function effectiveValue<T>(utxo: Utxo<T>, feeRate: number): bigint {
  return utxo.value - feeForWeight(utxo.weight, feeRate);
}

export function selectionTarget<TUtxo, TTarget>(request: SelectionRequest<TUtxo, TTarget>): bigint {
  const emptyInputs: readonly Utxo<TUtxo>[] = [];
  const fixedWeight = transactionWeight(
    emptyInputs,
    request.targets,
    request.baseWeight ?? DEFAULT_BASE_WEIGHT,
  );

  return targetValue(request.targets) + feeForWeight(fixedWeight, request.feeRate);
}

function selectedTargets<T>(targets: readonly Target<T>[]): readonly SelectedOutput<T>[] {
  return targets.map((target) => {
    const base = {
      value: target.value ?? 0n,
      weight: target.weight,
      isChange: false,
    };

    return target.meta === undefined ? base : { ...base, meta: target.meta };
  });
}

export function finalizeSelection<TUtxo, TTarget>(
  request: SelectionRequest<TUtxo, TTarget>,
  inputs: readonly Utxo<TUtxo>[],
  strategy: StrategyName,
  outputValues?: readonly bigint[],
): SelectionResult<TUtxo, TTarget> {
  const selectedValue = sumValues(inputs);

  let outputs = selectedTargets(request.targets);

  if (outputValues !== undefined) {
    outputs = outputs.map((output, index) => ({
      ...output,
      value: outputValues[index] ?? output.value,
    }));
  }

  const outputsValue = outputs.reduce((sum, output) => sum + output.value, 0n);
  const baseWeight = request.baseWeight ?? DEFAULT_BASE_WEIGHT;
  const noChangeWeight = transactionWeight(inputs, outputs, baseWeight);
  const noChangeMinimumFee = feeForWeight(noChangeWeight, request.feeRate);
  const excess = selectedValue - outputsValue - noChangeMinimumFee;

  if (excess < 0n) {
    return {
      ok: false,
      reason: "insufficient-funds",
      message: "selected inputs do not cover targets and fees",
      available: selectedValue,
      required: outputsValue + noChangeMinimumFee,
    };
  }

  let finalWeight = noChangeWeight;
  let change = 0n;

  if (request.change) {
    const provisionalChange: SelectedOutput<TTarget> = {
      value: 0n,
      weight: request.change.outputWeight,
      isChange: true,
    };
    const withChangeWeight = transactionWeight(inputs, [...outputs, provisionalChange], baseWeight);
    const withChangeFee = feeForWeight(withChangeWeight, request.feeRate);
    const possibleChange = selectedValue - outputsValue - withChangeFee;

    if (possibleChange >= minimumChange(request, request.change)) {
      change = possibleChange;
      finalWeight = withChangeWeight;
      outputs = [...outputs, { ...provisionalChange, value: change }];
    }
  }

  const maxWeight = request.maxWeight ?? DEFAULT_MAX_WEIGHT;

  if (finalWeight > maxWeight) {
    return {
      ok: false,
      reason: "max-weight-exceeded",
      message: `transaction weight ${String(finalWeight)} exceeds limit ${String(maxWeight)}`,
      available: selectedValue,
      required: outputsValue + noChangeMinimumFee,
    };
  }

  const outputSum = outputs.reduce((sum, output) => sum + output.value, 0n);
  const fee = selectedValue - outputSum;
  const longTermFeeRate = request.longTermFeeRate ?? request.feeRate;
  const inputWeight = sumWeights(inputs);
  const feeDelta =
    feeForWeight(inputWeight, request.feeRate) - feeForWeight(inputWeight, longTermFeeRate);
  const waste =
    change > 0n && request.change !== undefined
      ? feeDelta +
        feeForWeight(request.change.outputWeight, request.feeRate) +
        feeForWeight(request.change.spendWeight, longTermFeeRate)
      : feeDelta + excess;
  const success: SelectionSuccess<TUtxo, TTarget> = {
    ok: true,
    inputs: [...inputs],
    outputs,
    fee,
    change,
    waste,
    weight: finalWeight,
    strategy,
  };

  return success;
}

export function betterResult<TUtxo, TTarget>(
  current: SelectionSuccess<TUtxo, TTarget> | undefined,
  candidate: SelectionSuccess<TUtxo, TTarget>,
): SelectionSuccess<TUtxo, TTarget> {
  if (!current) {
    return candidate;
  }

  if (candidate.waste !== current.waste) {
    return candidate.waste < current.waste ? candidate : current;
  }

  if (candidate.fee !== current.fee) {
    return candidate.fee < current.fee ? candidate : current;
  }

  if (candidate.inputs.length !== current.inputs.length) {
    return candidate.inputs.length > current.inputs.length ? candidate : current;
  }

  return candidate.weight < current.weight ? candidate : current;
}
