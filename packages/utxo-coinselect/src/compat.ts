/**
 * Drop-in replacement for the `coinselect` package (bitcoinjs/coinselect).
 *
 * Same call shapes and result shape — `(utxos, outputs, feeRate)` in,
 * `{ inputs, outputs, fee }` out, plain numbers for amounts, the input
 * objects returned by reference, a `{ value }` change output — but priced
 * with this package's engine: Bitcoin Core fee rounding and dust rules, and
 * exact weights when you provide them.
 *
 * Migrating is an import change:
 *
 * ```ts
 * // before: import coinSelect from "coinselect";
 * import { coinSelect } from "utxo-coinselect/compat";
 * ```
 */
import {
  DEFAULT_BASE_WEIGHT,
  DEFAULT_MAX_WEIGHT,
  effectiveValue,
  finalizeSelection,
  selectionTarget,
  transactionWeight,
  validateRequest,
  withoutChange,
} from "./engine";
import { selectCoins } from "./strategies";
import type {
  ChangePolicy,
  SelectionFailure,
  SelectionRequest,
  SelectionResult,
  StrategyName,
  Target,
  Utxo,
} from "./types";
import { feeForWeight, inputWeight, outputWeight, relayDustThreshold } from "./weights";

/** Anything with a byte length, such as a Node.js `Buffer` or a `Uint8Array`. */
export interface ScriptLike {
  readonly length: number;
}

export interface CompatUtxo {
  /** Satoshis, as a non-negative safe integer. */
  readonly value: number;
  /** Exact input weight in WU (see `inputWeight()`). Takes precedence over `script`. */
  readonly weight?: number;
  /**
   * coinselect sizing: the input is `41 + script.length` bytes, with a
   * P2PKH scriptSig (107 bytes) when omitted. Prefer `weight` for SegWit and
   * Taproot inputs, which this rule overprices.
   */
  readonly script?: ScriptLike;
}

export interface CompatOutput {
  /** Satoshis. Omit only for `split` outputs, which share the remainder equally. */
  readonly value?: number;
  /** Exact output weight in WU (see `outputWeight()`). Takes precedence over `script`. */
  readonly weight?: number;
  /** coinselect sizing: the output is `9 + script.length` bytes, P2PKH (25 bytes) when omitted. */
  readonly script?: ScriptLike;
}

/** The change output appended to `outputs`. Like coinselect, it carries no address. */
export interface CompatChangeOutput {
  readonly value: number;
}

export interface CompatOptions {
  /** Change output weight in WU. Defaults to P2PKH, as coinselect assumes. */
  readonly changeOutputWeight?: number;
  /** Weight to spend the change later, in WU. Defaults to a P2PKH input. */
  readonly changeSpendWeight?: number;
  /** Explicit dust floor for change, in satoshis. Defaults to Bitcoin Core's rules. */
  readonly dustThreshold?: number;
  /** Fee rate (sat/vB) assumed for spending change later. Defaults to `feeRate`. */
  readonly longTermFeeRate?: number;
  /** Maximum transaction weight in WU. Defaults to 400,000. */
  readonly maxWeight?: number;
  /** Seed for randomized strategies such as `best`. */
  readonly seed?: number;
}

export interface CoinSelectOptions extends CompatOptions {
  /**
   * Any utxo-coinselect strategy. Defaults to coinselect's own algorithm:
   * Blackjack, then accumulative, by descending effective value
   * (`exact-biggest/accum-biggest`). `"best"` usually finds cheaper selections.
   */
  readonly strategy?: StrategyName;
}

/** Why no selection was made. An extension: coinselect only leaves `inputs` undefined. */
export interface CompatError {
  readonly reason: SelectionFailure["reason"];
  readonly message: string;
}

export interface CompatResult<U, O> {
  /** Selected UTXOs (the objects you passed), or undefined on failure. */
  readonly inputs?: U[];
  /** Your outputs plus an optional `{ value }` change output, or undefined on failure. */
  readonly outputs?: (O | CompatChangeOutput)[];
  /** Miner fee in satoshis. On failure, the fee for the outputs alone; NaN for invalid input. */
  readonly fee: number;
  readonly error?: CompatError;
}

interface Built<U, O> {
  readonly ok: true;
  readonly request: SelectionRequest<U, O> & { readonly change: ChangePolicy };
}

const COMPAT_TXID = "utxo-coinselect-compat";
const P2PKH_SCRIPT_SIG_BYTES = 107;
const P2PKH_SCRIPT_PUBKEY_BYTES = 25;

/**
 * Outputs are typed as any object so that literals such as `{ address }` (a
 * `split` output with no value) are accepted; the fields this module reads are
 * the optional ones in {@link CompatOutput}, validated at runtime.
 */
function fields(output: object): CompatOutput {
  return output;
}

function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function invalid<U, O>(message: string): CompatResult<U, O> {
  return { fee: Number.NaN, error: { reason: "invalid-request", message } };
}

function failed<U, O>(
  failure: SelectionFailure,
  targets: readonly Target<O>[],
): CompatResult<U, O> {
  const outputsValue = targets.reduce((sum, target) => sum + (target.value ?? 0n), 0n);

  return {
    fee: failure.required === undefined ? Number.NaN : Number(failure.required - outputsValue),
    error: { reason: failure.reason, message: failure.message },
  };
}

function build<U extends CompatUtxo, O extends object>(
  utxos: readonly U[],
  outputs: readonly O[],
  feeRate: number,
  options: CoinSelectOptions,
  strategy: StrategyName,
): Built<U, O> | CompatResult<U, O> {
  const badUtxo = utxos.findIndex((utxo) => !isAmount(utxo.value));

  if (badUtxo !== -1) {
    return invalid(`utxos[${String(badUtxo)}].value must be a non-negative safe integer`);
  }

  const badOutput = outputs.findIndex(
    (output) => fields(output).value !== undefined && !isAmount(fields(output).value),
  );

  if (badOutput !== -1) {
    return invalid(`outputs[${String(badOutput)}].value must be a non-negative safe integer`);
  }

  if (options.dustThreshold !== undefined && !isAmount(options.dustThreshold)) {
    return invalid("dustThreshold must be a non-negative safe integer");
  }

  const targets = outputs.map((output): Target<O> => {
    const { value, weight, script } = fields(output);
    const outputWeightUnits =
      weight ??
      outputWeight({
        type: "raw",
        scriptPubKeyBytes: script?.length ?? P2PKH_SCRIPT_PUBKEY_BYTES,
      });

    return value === undefined
      ? { weight: outputWeightUnits, meta: output }
      : { value: BigInt(value), weight: outputWeightUnits, meta: output };
  });
  const [first, ...rest] = targets;

  if (first === undefined) {
    return invalid("at least one output is required");
  }

  const request = {
    utxos: utxos.map((utxo, index): Utxo<U> => ({
      txid: COMPAT_TXID,
      vout: index,
      value: BigInt(utxo.value),
      weight:
        utxo.weight ??
        inputWeight({
          type: "raw",
          scriptSigBytes: utxo.script?.length ?? P2PKH_SCRIPT_SIG_BYTES,
        }),
      // Index order: lets `oldest-first` walk the UTXOs in the order given.
      timestamp: index,
      meta: utxo,
    })),
    targets: [first, ...rest] as const,
    feeRate,
    strategy,
    change: {
      outputWeight: options.changeOutputWeight ?? outputWeight("p2pkh"),
      spendWeight: options.changeSpendWeight ?? inputWeight("p2pkh"),
      ...(options.dustThreshold === undefined
        ? {}
        : { dustThreshold: BigInt(options.dustThreshold) }),
    },
    ...(options.longTermFeeRate === undefined ? {} : { longTermFeeRate: options.longTermFeeRate }),
    ...(options.maxWeight === undefined ? {} : { maxWeight: options.maxWeight }),
    ...(options.seed === undefined ? {} : { seed: options.seed }),
  };

  return { ok: true, request };
}

function isBuilt<U, O>(value: Built<U, O> | CompatResult<U, O>): value is Built<U, O> {
  return "ok" in value;
}

function compatResult<U, O>(
  result: SelectionResult<U, O>,
  targets: readonly Target<O>[],
): CompatResult<U, O> {
  if (!result.ok) {
    return failed(result, targets);
  }

  return {
    // Safe by construction: every engine UTXO and target built here carries
    // the caller's original object as `meta`.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    inputs: result.inputs.map((input) => input.meta!),
    outputs: result.outputs.map((output) => {
      if (output.isChange) {
        return { value: Number(output.value) };
      }

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const original = output.meta!;

      return fields(original).value === Number(output.value)
        ? original
        : { ...original, value: Number(output.value) };
    }),
    fee: Number(result.fee),
  };
}

/**
 * coinselect's default: Blackjack, then accumulative, by descending effective
 * value — with accurate fees and dust. Pass `{ strategy }` for any other
 * utxo-coinselect strategy.
 */
export function coinSelect<U extends CompatUtxo, O extends object>(
  utxos: readonly U[],
  outputs: readonly O[],
  feeRate: number,
  options: CoinSelectOptions = {},
): CompatResult<U, O> {
  const built = build(
    utxos,
    outputs,
    feeRate,
    options,
    options.strategy ?? "exact-biggest/accum-biggest",
  );

  return isBuilt(built) ? compatResult(selectCoins(built.request), built.request.targets) : built;
}

/** coinselect's `accumulative`: adds UTXOs in the order given until the outputs are funded. */
export function accumulative<U extends CompatUtxo, O extends object>(
  utxos: readonly U[],
  outputs: readonly O[],
  feeRate: number,
  options: CompatOptions = {},
): CompatResult<U, O> {
  return coinSelect(utxos, outputs, feeRate, { ...options, strategy: "oldest-first" });
}

/**
 * coinselect's `blackjack`: adds UTXOs in the order given, skipping any that
 * would overshoot the changeless range, and never creates change.
 */
export function blackjack<U extends CompatUtxo, O extends object>(
  utxos: readonly U[],
  outputs: readonly O[],
  feeRate: number,
  options: CompatOptions = {},
): CompatResult<U, O> {
  const built = build(utxos, outputs, feeRate, options, "blackjack");

  if (!isBuilt(built)) {
    return built;
  }

  const { request } = built;
  const requestError = validateRequest(request);

  if (requestError !== undefined) {
    return failed(requestError, request.targets);
  }

  const target = selectionTarget(request);
  const upper =
    target +
    feeForWeight(request.change.outputWeight, feeRate) +
    feeForWeight(request.change.spendWeight, request.longTermFeeRate ?? feeRate);
  const changeless = withoutChange(request);
  const selected: Utxo<U>[] = [];

  let selectedEffective = 0n;

  for (const utxo of request.utxos) {
    const value = effectiveValue(utxo, feeRate);

    if (value <= 0n || selectedEffective + value > upper) {
      continue;
    }

    selected.push(utxo);
    selectedEffective += value;

    if (selectedEffective < target) {
      continue;
    }

    const result = finalizeSelection(changeless, selected, "blackjack");

    if (result.ok) {
      return compatResult(result, request.targets);
    }
  }

  return failed(
    {
      ok: false,
      reason: "insufficient-funds",
      message: "no in-order selection funds the outputs without overshooting",
      required: target,
    },
    request.targets,
  );
}

/**
 * coinselect's `split`: spends every UTXO, pays outputs that have a value, and
 * divides the remainder equally between outputs without one. Fails instead of
 * creating a dust share.
 */
export function split<U extends CompatUtxo, O extends object>(
  utxos: readonly U[],
  outputs: readonly O[],
  feeRate: number,
  options: CompatOptions = {},
): CompatResult<U, O> {
  const built = build(utxos, outputs, feeRate, options, "largest-first");

  if (!isBuilt(built)) {
    return built;
  }

  const { request } = built;
  const open = request.targets.filter((target) => target.value === undefined);
  // Validate with the open outputs priced at zero: the engine's own `split`
  // supports a single open output, coinselect's any number.
  const requestError = validateRequest({
    ...request,
    targets: request.targets.map((target) => ({ ...target, value: target.value ?? 0n })) as [
      Target<O>,
      ...Target<O>[],
    ],
  });

  if (requestError !== undefined) {
    return failed(requestError, request.targets);
  }

  const inputs = request.utxos.map((utxo) => ({ ...utxo, required: true }));

  if (open.length === 0) {
    return compatResult(selectCoins({ ...request, utxos: inputs }), request.targets);
  }

  const weight = transactionWeight(inputs, request.targets, DEFAULT_BASE_WEIGHT);
  const maxWeight = request.maxWeight ?? DEFAULT_MAX_WEIGHT;
  const fee = feeForWeight(weight, feeRate);
  const fixed = request.targets.reduce((sum, target) => sum + (target.value ?? 0n), 0n);

  if (weight > maxWeight) {
    return failed(
      {
        ok: false,
        reason: "max-weight-exceeded",
        message: `transaction weight ${String(weight)} exceeds limit ${String(maxWeight)}`,
        required: fixed + fee,
      },
      request.targets,
    );
  }

  const inputValue = inputs.reduce((sum, utxo) => sum + utxo.value, 0n);
  const share = (inputValue - fixed - fee) / BigInt(open.length);
  const dust = open.reduce((floor, target) => {
    const threshold = relayDustThreshold(target.weight);

    return threshold > floor ? threshold : floor;
  }, 0n);

  if (share < dust) {
    return failed(
      {
        ok: false,
        reason: "insufficient-funds",
        message: `each split output would be ${String(share)} sats, below the ${String(dust)} sat dust threshold`,
        required: fixed + fee + dust * BigInt(open.length),
      },
      request.targets,
    );
  }

  return {
    inputs: [...utxos],
    // Like coinselect: outputs with a value are returned as given, open ones copied with their share.
    outputs: outputs.map((output) =>
      fields(output).value === undefined ? { ...output, value: Number(share) } : output,
    ),
    // The integer-division remainder goes to the fee.
    fee: Number(inputValue - fixed - share * BigInt(open.length)),
  };
}

/**
 * coinselect's `break`: spends every UTXO into as many copies of `output` as
 * fit, plus change when it is worth keeping.
 */
export function broken<U extends CompatUtxo, O extends object>(
  utxos: readonly U[],
  output: O,
  feeRate: number,
  options: CompatOptions = {},
): CompatResult<U, O> {
  return coinSelect(utxos, [output], feeRate, { ...options, strategy: "break" });
}
