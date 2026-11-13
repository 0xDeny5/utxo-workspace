import { afterEach, describe, expect, it, vi } from "vitest";

import type { SelectionRequest, StrategyName, Target, Utxo } from "../src/index";
import {
  dustThresholdFor,
  feeForWeight,
  inputWeight,
  outputWeight,
  P2SH_MULTISIG,
  P2WSH_MULTISIG,
  relayDustThreshold,
  selectAccumulative,
  selectBest,
  selectBlackjack,
  selectBranchAndBound,
  selectCoinGrinder,
  selectCoins,
  selectionTarget,
  selectKnapsack,
  selectSingleRandomDraw,
} from "../src/index";

const P2WPKH_IN = inputWeight("p2wpkh");
const P2WPKH_OUT = outputWeight("p2wpkh");
const P2WPKH_CHANGE = { outputWeight: P2WPKH_OUT, spendWeight: P2WPKH_IN } as const;

function coin(vout: number, value: bigint, overrides: Partial<Utxo> = {}): Utxo {
  return { txid: "aa".repeat(32), vout, value, weight: P2WPKH_IN, ...overrides };
}

function pay(value: bigint, weight = P2WPKH_OUT): [Target] {
  return [{ value, weight }];
}

function outpoints(result: ReturnType<typeof selectCoins>): number[] {
  return result.ok ? result.inputs.map((input) => input.vout) : [];
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fee rounding matches Bitcoin Core's vsize pricing", () => {
  it("rounds weight up to whole vbytes before applying the fee rate", () => {
    // 561 WU is 141 vB; ceil(561 / 4 * 10) would be 1403 sat, which is 9.95 sat/vB.
    expect(feeForWeight(561, 10)).toBe(1_410n);
    expect(feeForWeight(562, 50)).toBe(7_050n);
    expect(feeForWeight(561, 0.1)).toBe(15n);
  });

  it("never pays below the requested rate per vbyte", () => {
    for (let weight = 0; weight < 2_000; weight += 7) {
      for (const rate of [0.1, 1, 1.5, 3.3, 10, 57]) {
        const vbytes = Math.ceil(weight / 4);

        expect(Number(feeForWeight(weight, rate))).toBeGreaterThanOrEqual(vbytes * rate - 1e-9);
      }
    }
  });
});

describe("dust follows Bitcoin Core's GetDustThreshold", () => {
  it("uses Core's 67 vB / 148 vB spend estimates", () => {
    expect(relayDustThreshold(outputWeight("p2wpkh"))).toBe(294n);
    expect(relayDustThreshold(outputWeight("p2tr"))).toBe(330n);
    expect(relayDustThreshold(outputWeight("p2wsh"))).toBe(330n);
    expect(relayDustThreshold(outputWeight("p2a"))).toBe(240n);
    expect(relayDustThreshold(outputWeight("p2pkh"))).toBe(546n);
    expect(relayDustThreshold(outputWeight("p2sh"))).toBe(540n);
    expect(relayDustThreshold(outputWeight("p2pk"))).toBe(576n);
    expect(relayDustThreshold(outputWeight("p2wpkh"), 1)).toBe(98n);
    // A weight that is not a whole number of bytes cannot be a known witness program.
    expect(relayDustThreshold(125)).toBe(540n);
  });

  it("never derives a change floor below the relay threshold", () => {
    expect(dustThresholdFor(outputWeight("p2tr"), inputWeight("p2tr"))).toBe(330n);
    expect(dustThresholdFor(outputWeight("p2sh"), inputWeight("p2sh-p2wpkh"))).toBe(540n);
    expect(dustThresholdFor(P2WPKH_OUT, P2WPKH_IN)).toBe(297n);
  });

  it("does not create Taproot change that Core would reject as dust", () => {
    const changePolicy = { outputWeight: outputWeight("p2tr"), spendWeight: inputWeight("p2tr") };
    const target = pay(10_000n);
    const changeFee = feeForWeight(
      34 + 4 + 4 + P2WPKH_IN + P2WPKH_OUT + changePolicy.outputWeight,
      1,
    );
    // Leaves 310 sats of change: above the old 302 sat floor, below Core's 330.
    const value = 10_000n + changeFee + 310n;
    const result = selectCoins({
      utxos: [coin(0, value)],
      targets: target,
      feeRate: 1,
      change: changePolicy,
      strategy: "largest-first",
    });

    expect(result).toMatchObject({ ok: true, change: 0n });
  });
});

describe("change is only created when it is worth spending", () => {
  const request = (longTermFeeRate: number): SelectionRequest => ({
    utxos: [coin(0, 8_000n)],
    targets: pay(5_000n),
    feeRate: 1,
    longTermFeeRate,
    change: P2WPKH_CHANGE,
    strategy: "largest-first",
  });

  it("drops change that costs more to spend later than it is worth", () => {
    // 2_859 sats of change would cost 68 vB * 50 sat/vB = 3_400 sats to spend.
    expect(selectCoins(request(50))).toMatchObject({ ok: true, change: 0n, fee: 3_000n });
  });

  it("keeps change that is worth spending", () => {
    expect(selectCoins(request(1))).toMatchObject({ ok: true, change: 2_859n, fee: 141n });
  });
});

describe("Branch-and-Bound", () => {
  const zeroFee = (values: readonly bigint[], target: bigint): SelectionRequest => ({
    utxos: values.map((value, vout) => coin(vout, value, { weight: 0 })),
    targets: [{ value: target, weight: 0 }],
    feeRate: 0,
    baseWeight: 0,
    change: { outputWeight: 0, spendWeight: 0, dustThreshold: 1n },
    strategy: "branch-and-bound",
  });

  it("still explores branches that skip every copy of a duplicated coin", () => {
    expect(outpoints(selectCoins(zeroFee([5n, 5n, 4n], 4n)))).toEqual([2]);
    expect(outpoints(selectCoins(zeroFee([6n, 6n, 5n], 5n)))).toEqual([2]);
    expect(outpoints(selectCoins(zeroFee([3n, 3n, 2n, 2n], 4n)))).toEqual([2, 3]);
    expect(outpoints(selectCoins(zeroFee([5n, 5n, 1n, 1n, 1n], 3n)))).toEqual([2, 3, 4]);
    expect(outpoints(selectCoins(zeroFee([4n, 4n, 4n, 4n], 8n)))).toEqual([0, 1]);
  });

  it("keeps changeless solutions inside the cost-of-change window", () => {
    const target = pay(50_000n);
    const need = selectionTarget({ utxos: [], targets: target, feeRate: 10 });
    const excess = 800n; // below the 990 sat cost of change, above the dust floor
    const value = need + feeForWeight(P2WPKH_IN, 10) + excess;
    const base = { utxos: [coin(0, value)], targets: target, feeRate: 10, change: P2WPKH_CHANGE };

    for (const strategy of ["branch-and-bound", "blackjack", "best"] as const) {
      expect(selectCoins({ ...base, strategy })).toMatchObject({ ok: true, change: 0n });
    }
  });
});

describe("send-all", () => {
  const sendAll = (value: bigint): SelectionRequest => ({
    utxos: [coin(0, value)],
    targets: [{ weight: P2WPKH_OUT }],
    feeRate: 1,
    strategy: "split",
  });

  it("refuses to create a dust output", () => {
    // 438 WU is 110 vB of fee, so 403 sats leave 293 sats: below the 294 sat P2WPKH dust limit.
    const result = selectCoins(sendAll(403n));

    expect(result).toMatchObject({ ok: false, reason: "insufficient-funds" });
    expect(!result.ok && result.message).toContain("dust");
    expect(selectCoins(sendAll(404n))).toMatchObject({ ok: true, fee: 110n });
  });
});

describe("dedicated helpers validate like selectCoins", () => {
  const invalidRequest: SelectionRequest = {
    utxos: [coin(0, -5n), coin(1, 100_000n)],
    targets: pay(1_000n),
    feeRate: 1,
  };

  it.each([
    ["selectAccumulative", selectAccumulative],
    ["selectBest", selectBest],
    ["selectBlackjack", selectBlackjack],
    ["selectBranchAndBound", selectBranchAndBound],
    ["selectCoinGrinder", selectCoinGrinder],
    ["selectKnapsack", selectKnapsack],
    ["selectSingleRandomDraw", selectSingleRandomDraw],
  ])("%s rejects invalid input", (_name, helper) => {
    expect(helper(invalidRequest)).toMatchObject({ ok: false, reason: "invalid-request" });
  });

  it("keeps alias names in results", () => {
    const valid = { ...invalidRequest, utxos: [coin(1, 100_000n)], change: P2WPKH_CHANGE };

    expect(
      selectBranchAndBound({ ...valid, strategy: "bnb", targets: pay(99_850n) }),
    ).toMatchObject({ strategy: "bnb" });
    expect(selectSingleRandomDraw({ ...valid, strategy: "srd", seed: 1 })).toMatchObject({
      strategy: "srd",
    });
    expect(selectBest({ ...valid, seed: 1 })).toMatchObject({ ok: true });
  });
});

describe("request validation", () => {
  const base: SelectionRequest = {
    utxos: [coin(0, 10_000n)],
    targets: pay(1_000n),
    feeRate: 1,
  };

  it("rejects number amounts with a hint instead of throwing a BigInt TypeError", () => {
    const numericUtxo = { ...coin(0, 0n), value: 10_000 } as unknown as Utxo;
    const numericTarget = { value: 1_000, weight: P2WPKH_OUT } as unknown as Target;

    expect(selectCoins({ ...base, utxos: [numericUtxo] })).toMatchObject({
      reason: "invalid-request",
      message: expect.stringContaining("bigint") as unknown,
    });
    expect(selectCoins({ ...base, targets: [numericTarget] })).toMatchObject({
      reason: "invalid-request",
      message: expect.stringContaining("bigint") as unknown,
    });
  });

  it.each([
    ["change.outputWeight", { change: { ...P2WPKH_CHANGE, outputWeight: -1 } }],
    ["change.spendWeight", { change: { ...P2WPKH_CHANGE, spendWeight: 1.5 } }],
    ["change.dustThreshold", { change: { ...P2WPKH_CHANGE, dustThreshold: -1n } }],
    [
      "change.dustThreshold",
      { change: { ...P2WPKH_CHANGE, dustThreshold: 546 as unknown as bigint } },
    ],
    ["change.dustRelayFeeRate", { change: { ...P2WPKH_CHANGE, dustRelayFeeRate: Number.NaN } }],
    ["change.dustRelayFeeRate", { change: { ...P2WPKH_CHANGE, dustRelayFeeRate: -3 } }],
    ["baseWeight", { baseWeight: -1 }],
    ["maxWeight", { maxWeight: 1.5 }],
    ["maxIterations", { maxIterations: Number.POSITIVE_INFINITY }],
    ["minConfirmations", { minConfirmations: -1 }],
    ["seed", { seed: 0.5 }],
  ] as const)("rejects an invalid %s", (field, overrides) => {
    expect(selectCoins({ ...base, ...overrides })).toMatchObject({
      ok: false,
      reason: "invalid-request",
      message: expect.stringContaining(field) as unknown,
    });
  });

  it("accepts valid optional fields", () => {
    expect(
      selectCoins({
        ...base,
        change: { ...P2WPKH_CHANGE, dustThreshold: 600n, dustRelayFeeRate: 1 },
        baseWeight: 32,
        maxWeight: 400_000,
        maxIterations: 10,
        minConfirmations: 0,
        seed: -7,
        strategy: "largest-first",
      }),
    ).toMatchObject({ ok: true });
  });
});

describe("failure reasons", () => {
  const heavy = (strategy: StrategyName, required = false): SelectionRequest => ({
    utxos: [0, 1, 2].map((vout) => coin(vout, 50_000n, { required })),
    targets: pay(120_000n),
    feeRate: 1,
    maxWeight: 900,
    strategy,
    seed: 3,
  });

  it("reports max weight instead of insufficient funds", () => {
    for (const strategy of ["largest-first", "knapsack", "best"] as const) {
      expect(selectCoins(heavy(strategy))).toMatchObject({
        ok: false,
        reason: "max-weight-exceeded",
        available: 150_000n,
      });
    }

    expect(selectCoins(heavy("smallest-first", true))).toMatchObject({
      reason: "max-weight-exceeded",
    });
    expect(selectCoins(heavy("blackjack", true))).toMatchObject({ ok: false });
    expect(
      selectCoins({
        utxos: [coin(0, 1_110n)],
        targets: pay(1_000n),
        feeRate: 1,
        change: P2WPKH_CHANGE,
        maxWeight: 100,
        strategy: "blackjack",
      }),
    ).toMatchObject({ ok: false });
  });

  it("prefers a search limit over insufficient funds when every strategy fails", () => {
    const { maxWeight: _maxWeight, ...unlimited } = heavy("best");

    expect(selectCoins({ ...unlimited, targets: pay(200_000n), maxIterations: 0 })).toMatchObject({
      reason: "search-exhausted",
    });
  });
});

describe("random strategies", () => {
  const request = (seed?: number): SelectionRequest => ({
    utxos: Array.from({ length: 12 }, (_, vout) => coin(vout, BigInt(1_000 * (vout + 1)))),
    targets: pay(9_000n),
    feeRate: 1,
    change: P2WPKH_CHANGE,
    strategy: "single-random-draw",
    ...(seed === undefined ? {} : { seed }),
  });

  it("treats seed 0 as the default constant instead of a stuck generator", () => {
    expect(outpoints(selectCoins(request(0)))).toEqual(
      outpoints(selectCoins(request(0x9e37_79b9))),
    );
  });

  it("draws a seed from crypto.getRandomValues when none is given", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (values: Uint32Array) => {
        values[0] = 42;

        return values;
      },
    });

    expect(outpoints(selectCoins(request()))).toEqual(outpoints(selectCoins(request(42))));
  });

  it("falls back to Math.random without Web Crypto", () => {
    vi.stubGlobal("crypto", undefined);
    vi.spyOn(Math, "random").mockReturnValue(42 / 0x1_0000_0000);

    expect(outpoints(selectCoins(request()))).toEqual(outpoints(selectCoins(request(42))));
  });

  it("varies between calls by default", () => {
    const seen = new Set(
      Array.from({ length: 20 }, () => outpoints(selectCoins(request())).join()),
    );

    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("multisig script sizes", () => {
  it("counts a 2-byte push for m or n above 16", () => {
    // OP_1, 20 keys, a 2-byte push of 20, OP_CHECKMULTISIG = 684 bytes of witnessScript.
    expect(inputWeight(P2WSH_MULTISIG(1, 20))).toBe(164 + 1 + 1 + 74 + 3 + 684);
    expect(inputWeight(P2WSH_MULTISIG(17, 17))).toBe(164 + 1 + 1 + 17 * 74 + 3 + 583);
    expect(inputWeight(P2WSH_MULTISIG(16, 16))).toBe(164 + 1 + 1 + 16 * 74 + 3 + 547);
  });

  it("rejects P2SH multisig whose redeemScript exceeds 520 bytes", () => {
    expect(() => inputWeight(P2SH_MULTISIG(1, 15))).not.toThrow();
    expect(() => inputWeight(P2SH_MULTISIG(1, 16))).toThrow(RangeError);
  });
});

describe("large wallets", () => {
  it("selects from 5,000 UTXOs within a few seconds", () => {
    const utxos = Array.from({ length: 5_000 }, (_, vout) =>
      coin(vout, BigInt(1_000 + ((vout * 7_919) % 1_000_000))),
    );
    const started = performance.now();
    const result = selectCoins({
      utxos,
      targets: pay(5_000_000n),
      feeRate: 5,
      change: P2WPKH_CHANGE,
      seed: 1,
    });

    expect(result.ok).toBe(true);
    expect(performance.now() - started).toBeLessThan(10_000);
  });
});
