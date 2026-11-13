import reference from "coinselect";
import referenceAccumulative from "coinselect/accumulative";
import referenceBlackjack from "coinselect/blackjack";
import referenceSplit from "coinselect/split";
import { describe, expect, it } from "vitest";

import type { CompatOutput, CompatUtxo } from "../src/compat";
import { accumulative, blackjack, broken, coinSelect, split } from "../src/compat";
import { inputWeight, outputWeight, relayDustThreshold } from "../src/index";

interface Coin extends CompatUtxo {
  readonly txId: string;
  readonly vout: number;
}

interface Payment extends CompatOutput {
  readonly address?: string;
}

function coins(...values: number[]): Coin[] {
  return values.map((value, vout) => ({ txId: "aa".repeat(32), vout, value }));
}

function pay(value: number, address = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT"): Payment {
  return { address, value };
}

function vouts(inputs: readonly Coin[] | undefined): number[] | undefined {
  return inputs?.map((input) => input.vout);
}

describe("coinSelect matches coinselect's selection", () => {
  it.each([
    ["accumulative path with change", coins(10_000, 20_000, 30_000, 40_000), 15_000, 5],
    ["changeless Blackjack path past a large decoy", coins(50_000, 10_200), 10_000, 1],
    ["insufficient funds", coins(1_000, 2_000), 50_000, 1],
  ])("%s", (_name, utxos, amount, feeRate) => {
    const outputs = [pay(amount)];
    const ours = coinSelect(utxos, outputs, feeRate);
    const theirs = reference(utxos, outputs, feeRate);

    expect(vouts(ours.inputs)).toEqual(vouts(theirs.inputs));
    expect(ours.outputs?.length).toBe(theirs.outputs?.length);
  });

  it("returns the caller's objects by reference and appends a bare change output", () => {
    const utxos = coins(10_000, 40_000);
    const outputs = [pay(15_000)];
    const result = coinSelect(utxos, outputs, 5);

    expect(result.inputs?.[0]).toBe(utxos[1]);
    expect(result.outputs?.[0]).toBe(outputs[0]);
    expect(result.outputs?.[1]).toEqual({ value: expect.any(Number) as unknown });
    expect(Object.keys(result.outputs?.[1] ?? {})).toEqual(["value"]);
    expect(result.error).toBeUndefined();

    const inputTotal = 40_000;
    const outputTotal = (result.outputs ?? []).reduce(
      (sum, output) => sum + (output.value ?? 0),
      0,
    );

    expect(result.fee).toBe(inputTotal - outputTotal);
  });

  it("prices exact weights below coinselect's P2PKH assumption", () => {
    const segwit = coins(40_000).map((coin) => ({ ...coin, weight: inputWeight("p2wpkh") }));
    const outputs = [{ ...pay(15_000), weight: outputWeight("p2wpkh") }];
    const exact = coinSelect(segwit, outputs, 10, {
      changeOutputWeight: outputWeight("p2wpkh"),
      changeSpendWeight: inputWeight("p2wpkh"),
    });
    const assumed = coinSelect(coins(40_000), [pay(15_000)], 10);

    // 34 + 4 + 4 + 272 + 124 + 124 WU = 562 WU = 141 vB.
    expect(exact.fee).toBe(1_410);
    expect(exact.fee).toBeLessThan(assumed.fee);
  });

  it("sizes inputs and outputs from script length like coinselect", () => {
    const shortScript = { length: 23 };
    const base = coinSelect(coins(40_000), [pay(15_000)], 1);
    const scripted = coinSelect(
      coins(40_000).map((coin) => ({ ...coin, script: shortScript })),
      [{ ...pay(15_000), script: shortScript }],
      1,
    );

    // 107 - 23 = 84 fewer scriptSig bytes, 25 - 23 = 2 fewer scriptPubKey bytes.
    expect(base.fee - scripted.fee).toBe(86);
  });

  it("never creates change below Bitcoin Core's dust limit", () => {
    const outputs = [{ ...pay(10_000), weight: outputWeight("p2tr") }];
    const options = { changeOutputWeight: outputWeight("p2tr") } as const;
    const withChange = coinSelect(coins(20_000), outputs, 1, options);
    const change = withChange.outputs?.[1]?.value ?? 0;

    expect(change).toBeGreaterThanOrEqual(Number(relayDustThreshold(outputWeight("p2tr"))));

    const fee = withChange.fee;
    const justAboveTarget = 10_000 + fee + 320; // would leave 320 sats: below the 330 sat P2TR dust limit
    const changeless = coinSelect(coins(justAboveTarget), outputs, 1, options);

    expect(changeless.outputs).toHaveLength(1);
  });
});

describe("failures", () => {
  it("leaves inputs and outputs undefined and explains why", () => {
    const result = coinSelect(coins(1_000), [pay(50_000)], 1);

    expect(result.inputs).toBeUndefined();
    expect(result.outputs).toBeUndefined();
    // 34 + 4 + 4 + 136 WU = 178 WU = 45 vB for the outputs alone.
    expect(result.fee).toBe(45);
    expect(result.error).toMatchObject({ reason: "insufficient-funds" });
  });

  it.each([
    ["a fractional UTXO value", coins(1.5), [pay(1)], {}],
    ["a negative output value", coins(1_000), [pay(-1)], {}],
    ["no outputs", coins(1_000), [], {}],
    ["an invalid dust threshold", coins(1_000), [pay(1)], { dustThreshold: -1 }],
    ["an invalid fee rate", coins(1_000), [pay(1)], { feeRate: Number.NaN }],
    ["an open output outside split", coins(1_000), [{ address: "x" }], {}],
  ] as const)("returns NaN fee and invalid-request for %s", (_name, utxos, outputs, extra) => {
    const { feeRate = 1, ...options } = extra as { feeRate?: number; dustThreshold?: number };
    const result = coinSelect(utxos, outputs, feeRate, options);

    expect(result.fee).toBeNaN();
    expect(result.error).toMatchObject({ reason: "invalid-request" });
    expect(result.inputs).toBeUndefined();
  });
});

describe("options", () => {
  it("passes strategy, seed and the change policy through", () => {
    const utxos = coins(30_000, 45_000, 60_000, 12_000, 8_000);
    const result = coinSelect(utxos, [pay(50_000)], 3, {
      strategy: "best",
      seed: 7,
      longTermFeeRate: 1,
      dustThreshold: 1_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.inputs?.length).toBeGreaterThan(0);
  });

  it("enforces maxWeight", () => {
    expect(coinSelect(coins(40_000), [pay(15_000)], 1, { maxWeight: 100 })).toMatchObject({
      error: { reason: "max-weight-exceeded" },
    });
  });

  it("supports the engine's single-output split and copies the open output", () => {
    const open: Payment = { address: "sweep" };
    const result = coinSelect(coins(40_000), [open], 1, { strategy: "split" });

    expect(result.outputs?.[0]).toEqual({ address: "sweep", value: expect.any(Number) as unknown });
    expect(result.outputs?.[0]).not.toBe(open);
  });
});

describe("accumulative", () => {
  it("spends UTXOs in the order given, like coinselect", () => {
    const utxos = coins(5_000, 50_000);
    const outputs = [pay(4_000)];

    expect(vouts(accumulative(utxos, outputs, 1).inputs)).toEqual([0]);
    expect(vouts(referenceAccumulative(utxos, outputs, 1).inputs)).toEqual([0]);
  });
});

describe("blackjack", () => {
  it("adds UTXOs in order without overshooting and never creates change", () => {
    const utxos = coins(50_000, 6_000, 4_400);
    const outputs = [pay(10_000)];
    const ours = blackjack(utxos, outputs, 1);

    expect(vouts(ours.inputs)).toEqual([1, 2]);
    expect(vouts(referenceBlackjack(utxos, outputs, 1).inputs)).toEqual([1, 2]);
    expect(ours.outputs).toHaveLength(1);
  });

  it("fails rather than overshoot, and skips uneconomical UTXOs", () => {
    const result = blackjack(coins(50_000, 1), [pay(10_000)], 10);

    expect(result.inputs).toBeUndefined();
    expect(result.error).toMatchObject({ reason: "insufficient-funds" });
    expect(Number.isFinite(result.fee)).toBe(true);
  });

  it("keeps searching when a candidate cannot be finalized", () => {
    const result = blackjack(coins(10_200), [pay(10_000)], 1, { maxWeight: 100 });

    expect(result.error).toMatchObject({ reason: "insufficient-funds" });
  });

  it("validates input", () => {
    expect(blackjack(coins(1.5), [pay(1)], 1).error).toMatchObject({ reason: "invalid-request" });
    expect(blackjack(coins(1_000), [pay(1)], -1).error).toMatchObject({
      reason: "invalid-request",
    });
  });
});

describe("split", () => {
  it("shares the remainder equally between open outputs, like coinselect", () => {
    const utxos = coins(30_000, 20_000);
    const fixed = pay(5_000);
    const outputs: Payment[] = [fixed, { address: "a" }, { address: "b" }];
    const ours = split(utxos, outputs, 1);
    const theirs = referenceSplit(utxos, outputs, 1);

    expect(ours.inputs).toEqual(utxos);
    expect(ours.outputs?.[0]).toBe(fixed);
    expect(ours.outputs?.[1]?.value).toBe(ours.outputs?.[2]?.value);
    expect(ours.outputs?.[1]).toMatchObject({ address: "a" });
    expect(theirs.outputs).toHaveLength(3);

    const paid = (ours.outputs ?? []).reduce((sum, output) => sum + (output.value ?? 0), 0);

    expect(ours.fee).toBe(50_000 - paid);
  });

  it("refuses dust shares", () => {
    const result = split(coins(1_000), [{ address: "a" }, { address: "b" }], 1);

    expect(result.error).toMatchObject({ reason: "insufficient-funds" });
    expect(result.error?.message).toContain("dust");
  });

  it("finalizes like coinselect when every output has a value", () => {
    const result = split(coins(30_000, 20_000), [pay(10_000)], 1);

    expect(result.inputs).toHaveLength(2);
    expect(result.outputs).toHaveLength(2);
  });

  it("enforces maxWeight and validates input", () => {
    expect(split(coins(30_000), [{ address: "a" }], 1, { maxWeight: 100 }).error).toMatchObject({
      reason: "max-weight-exceeded",
    });
    expect(split(coins(30_000), [{ address: "a" }], -1).error).toMatchObject({
      reason: "invalid-request",
    });
    expect(split(coins(1.5), [{ address: "a" }], 1).error).toMatchObject({
      reason: "invalid-request",
    });
  });
});

describe("broken", () => {
  it("breaks UTXOs into copies of one output", () => {
    const template = pay(10_000);
    const result = broken(coins(35_000), template, 1);

    expect(result.outputs?.filter((output) => output === template)).toHaveLength(3);
  });
});
