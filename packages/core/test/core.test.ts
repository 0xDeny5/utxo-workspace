import { describe, expect, it } from "vitest";

import type { SelectionRequest, StrategyName, Utxo } from "../src/index";
import {
  compactSizeBytes,
  dustThresholdFor,
  effectiveValue,
  feeForWeight,
  finalizeSelection,
  inputWeight,
  outputWeight,
  P2SH_MULTISIG,
  P2SH_P2WSH_MULTISIG,
  P2TR_SCRIPT,
  P2WSH_MULTISIG,
  resolveDustThreshold,
  selectAccumulative,
  selectBlackjack,
  selectBranchAndBound,
  selectCoinGrinder,
  selectCoins,
  selectionTarget,
  selectKnapsack,
  selectSingleRandomDraw,
  STRATEGY_NAMES,
  sumValues,
  transactionWeight,
  weightToVBytes,
} from "../src/index";

const P2WPKH_IN = inputWeight("p2wpkh");
const P2WPKH_OUT = outputWeight("p2wpkh");

function utxo(label: string, value: bigint, overrides: Partial<Utxo> = {}): Utxo {
  const colon = label.lastIndexOf(":");
  const txid = colon === -1 ? label : label.slice(0, colon);
  const parsed = colon === -1 ? 0 : Number(label.slice(colon + 1));
  const vout = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;

  return { txid, vout, value, weight: P2WPKH_IN, ...overrides };
}

function request(utxos: readonly Utxo[], strategy: StrategyName = "best"): SelectionRequest {
  return {
    utxos,
    targets: [{ value: 1_000n, weight: P2WPKH_OUT }],
    feeRate: 1,
    longTermFeeRate: 1,
    change: {
      outputWeight: P2WPKH_OUT,
      spendWeight: P2WPKH_IN,
    },
    strategy,
    seed: 42,
  };
}

describe("weight catalog", () => {
  it("uses standard input constants", () => {
    expect(inputWeight("p2pk")).toBe(456);
    expect(inputWeight("p2pkh")).toBe(592);
    expect(inputWeight("p2wpkh")).toBe(272);
    expect(inputWeight("p2sh-p2wpkh")).toBe(364);
    expect(inputWeight("p2tr")).toBe(230);
  });

  it("calculates multisig weights", () => {
    expect(inputWeight(P2WSH_MULTISIG(2, 3))).toBe(420);
    expect(inputWeight(P2SH_P2WSH_MULTISIG(2, 3))).toBe(560);
    expect(inputWeight(P2SH_MULTISIG(2, 3))).toBe(1_196);
    expect(inputWeight({ ...P2WSH_MULTISIG(1, 1), signatureBytes: 72 })).toBe(277);
  });

  it("calculates raw and taproot-script weights", () => {
    expect(inputWeight({ type: "raw" })).toBe(164);
    expect(inputWeight({ type: "raw", scriptSigBytes: 253, witnessBytes: 20 })).toBe(
      (32 + 4 + 3 + 253 + 4) * 4 + 20,
    );
    expect(inputWeight(P2TR_SCRIPT(34, 1))).toBe(164 + 1 + 66 + 35 + 34);
    expect(
      inputWeight(
        P2TR_SCRIPT(70, 2, {
          stackElementBytes: [0, 300],
          controlBlockDepth: 2,
          signatureBytes: 64,
        }),
      ),
    ).toBeGreaterThan(500);
  });

  it("calculates standard and raw output weights", () => {
    expect(outputWeight("p2pk")).toBe(176);
    expect(outputWeight("p2pkh")).toBe(136);
    expect(outputWeight("p2sh")).toBe(128);
    expect(outputWeight("p2wpkh")).toBe(124);
    expect(outputWeight("p2wsh")).toBe(172);
    expect(outputWeight("p2tr")).toBe(172);
    expect(outputWeight("p2a")).toBe(52);
    expect(outputWeight({ type: "raw", scriptPubKeyBytes: 253 })).toBe((8 + 3 + 253) * 4);
  });

  it("supports CompactSize boundaries", () => {
    expect(compactSizeBytes(0)).toBe(1);
    expect(compactSizeBytes(252n)).toBe(1);
    expect(compactSizeBytes(253)).toBe(3);
    expect(compactSizeBytes(65_535)).toBe(3);
    expect(compactSizeBytes(65_536)).toBe(5);
    expect(compactSizeBytes(0x1_0000_0000n)).toBe(9);
    expect(() => compactSizeBytes(-1)).toThrow(RangeError);
    expect(() => compactSizeBytes(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });

  it("calculates fees without floating-point satoshi math", () => {
    expect(feeForWeight(272, 1)).toBe(68n);
    expect(feeForWeight(273, 1)).toBe(69n);
    expect(feeForWeight(400, 1.25)).toBe(125n);
    expect(feeForWeight(4, 1e-7)).toBe(1n);
    expect(feeForWeight(4, 1e3)).toBe(1_000n);
    expect(feeForWeight(0, 0)).toBe(0n);
    expect(() => feeForWeight(1, Number.NaN)).toThrow(RangeError);
    expect(() => feeForWeight(1, -1)).toThrow(RangeError);
    expect(() => feeForWeight(-1, 1)).toThrow(RangeError);
  });

  it("calculates vbytes and dust", () => {
    expect(weightToVBytes(273)).toBe(69);
    expect(dustThresholdFor(P2WPKH_OUT, P2WPKH_IN)).toBe(297n);
    expect(
      resolveDustThreshold({
        outputWeight: P2WPKH_OUT,
        spendWeight: P2WPKH_IN,
        dustThreshold: 500n,
      }),
    ).toBe(500n);
  });

  it("rejects impossible script parameters", () => {
    expect(() => inputWeight(P2WSH_MULTISIG(0, 1))).toThrow(RangeError);
    expect(() => inputWeight(P2WSH_MULTISIG(2, 1))).toThrow(RangeError);
    expect(() => inputWeight(P2WSH_MULTISIG(1, 21))).toThrow(RangeError);
    expect(() => inputWeight(P2TR_SCRIPT(1, 1, { controlBlockDepth: 129 }))).toThrow(RangeError);
    expect(() => inputWeight({ type: "raw", scriptSigBytes: -1 })).toThrow(RangeError);
  });
});

describe("shared transaction engine", () => {
  it("computes effective values, totals, target, and transaction weight", () => {
    const coin = utxo("a", 1_000n);
    const req = request([coin], "accumulative");

    expect(effectiveValue(coin, 1)).toBe(932n);
    expect(sumValues([coin, utxo("b", 2_000n)])).toBe(3_000n);
    expect(selectionTarget(req)).toBe(1_042n);
    expect(transactionWeight([coin], req.targets)).toBe(438);
  });

  it("finalizes change and changeless transactions", () => {
    const withChange = finalizeSelection(
      request([utxo("a", 5_000n)]),
      [utxo("a", 5_000n)],
      "largest-first",
    );

    expect(withChange).toMatchObject({
      ok: true,
      fee: 141n,
      change: 3_859n,
      weight: 562,
      waste: 99n,
    });

    const exact = finalizeSelection(
      request([utxo("exact", 1_110n)]),
      [utxo("exact", 1_110n)],
      "branch-and-bound",
    );

    expect(exact).toMatchObject({
      ok: true,
      fee: 110n,
      change: 0n,
      waste: 0n,
    });
  });

  it("reports insufficient funds and max weight", () => {
    const low = finalizeSelection(
      request([utxo("low", 1_000n)]),
      [utxo("low", 1_000n)],
      "largest-first",
    );

    expect(low).toMatchObject({ ok: false, reason: "insufficient-funds" });
    const heavy = finalizeSelection(
      { ...request([utxo("a", 5_000n)]), maxWeight: 100 },
      [utxo("a", 5_000n)],
      "largest-first",
    );

    expect(heavy).toMatchObject({ ok: false, reason: "max-weight-exceeded" });
  });

  it("uses explicit output values and target metadata", () => {
    const req: SelectionRequest<unknown, string> = {
      ...request([utxo("a", 5_000n)]),
      targets: [{ value: 1_000n, weight: P2WPKH_OUT, meta: "payee" }],
    };
    const result = finalizeSelection(req, req.utxos, "split", [2_000n]);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.outputs[0]).toMatchObject({ value: 2_000n, meta: "payee" });
    }
  });
});

describe("request validation", () => {
  it.each([
    [{ ...request([]), feeRate: -1 }, "feeRate"],
    [{ ...request([]), feeRate: Number.NaN }, "feeRate"],
    [{ ...request([]), longTermFeeRate: -1 }, "longTermFeeRate"],
    [{ ...request([]), targets: [] }, "target"],
    [{ ...request([]), targets: [{ weight: P2WPKH_OUT }], strategy: "best" }, "without values"],
    [
      {
        ...request([]),
        targets: [{ weight: 1 }, { weight: 1 }],
        strategy: "split",
      },
      "exactly one",
    ],
    [{ ...request([]), targets: [{ value: -1n, weight: 1 }] }, "negative"],
    [{ ...request([]), targets: [{ value: 1n, weight: -1 }] }, "weights"],
    [{ ...request([utxo("x", 1n), utxo("x", 2n)]) }, "duplicate"],
    [{ ...request([{ txid: "", vout: 0, value: 1n, weight: 1 }]) }, "txid"],
    [{ ...request([{ txid: "x", vout: -1, value: 1n, weight: 1 }]) }, "vout"],
    [{ ...request([{ txid: "x", vout: 0, value: -1n, weight: 1 }]) }, "negative"],
    [{ ...request([{ txid: "x", vout: 0, value: 1n, weight: -1 }]) }, "weight"],
  ] as const)("rejects malformed requests", (req, message) => {
    const result = selectCoins(req as SelectionRequest);

    expect(result).toMatchObject({ ok: false, reason: "invalid-request" });

    if (result.ok) {
      throw new Error("expected request validation failure");
    }

    expect(result.message).toContain(message);
  });

  it("rejects unknown runtime strategies", () => {
    const result = selectCoins({
      ...request([utxo("a", 5_000n)]),
      strategy: "unknown" as StrategyName,
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid-request" });
  });
});

describe("selection strategies", () => {
  it.each(STRATEGY_NAMES)("dispatches %s", (strategy) => {
    const base = request([utxo("exact", strategy === "break" ? 5_000n : 1_110n)], strategy);
    const result =
      strategy === "split"
        ? selectCoins({ ...base, targets: [{ weight: P2WPKH_OUT }] })
        : selectCoins(base);

    expect(result).toMatchObject({ ok: true });

    if (result.ok && strategy !== "best") {
      expect(result.strategy).toBe(strategy);
    }
  });

  it("selects in deterministic value and age orders", () => {
    const coins = [
      utxo("small", 1_500n, { timestamp: 30, confirmations: 1 }),
      utxo("large", 5_000n, { timestamp: 20, confirmations: 2 }),
      utxo("old", 2_000n, { timestamp: 10, confirmations: 10 }),
    ];

    expect(selectCoins(request(coins, "largest-first"))).toMatchObject({
      ok: true,
      inputs: [{ txid: "large", vout: 0 }],
    });
    expect(selectCoins(request(coins, "smallest-first"))).toMatchObject({
      ok: true,
      inputs: [{ txid: "small", vout: 0 }],
    });
    expect(selectCoins(request(coins, "oldest-first"))).toMatchObject({
      ok: true,
      inputs: [{ txid: "old", vout: 0 }],
    });
    expect(selectCoins(request(coins, "newest-first"))).toMatchObject({
      ok: true,
      inputs: [{ txid: "small", vout: 0 }],
    });
  });

  it("supports priority, pruned FIFO, accumulative, and blackjack", () => {
    const coins = [
      utxo("dusty", 200n, { timestamp: 1, confirmations: 100 }),
      utxo("priority", 1_500n, { timestamp: 2, confirmations: 20 }),
      utxo("new", 5_000n, { timestamp: 3, confirmations: 1 }),
    ];

    expect(selectCoins(request(coins, "pruned-fifo"))).toMatchObject({
      ok: true,
      inputs: [{ txid: "priority", vout: 0 }],
    });
    expect(selectCoins(request(coins, "high-priority-first"))).toMatchObject({
      ok: true,
      inputs: [{ txid: "priority", vout: 0 }],
    });
    expect(selectAccumulative(request(coins))).toMatchObject({ ok: true });
    expect(selectBlackjack(request([utxo("exact", 1_110n)]))).toMatchObject({
      ok: true,
      change: 0n,
    });
  });

  it("supports all exact/accumulative matrix order names", () => {
    const orders = ["biggest", "smallest", "oldest", "newest"] as const;

    for (const exact of orders) {
      for (const accum of orders) {
        const strategy = `exact-${exact}/accum-${accum}` as StrategyName;

        expect(selectCoins(request([utxo("a", 5_000n)], strategy))).toMatchObject({
          ok: true,
          strategy,
        });
      }
    }

    const invalidMatrix = selectCoins({
      ...request([utxo("a", 5_000n)]),
      strategy: "exact-nope/accum-nope" as StrategyName,
    });

    expect(invalidMatrix).toMatchObject({ ok: false, reason: "invalid-request" });
  });

  it("finds changeless Branch-and-Bound selections and aliases", () => {
    const coins = [utxo("a", 700n), utxo("b", 478n), utxo("exact", 1_110n)];

    expect(selectBranchAndBound(request(coins, "branch-and-bound"))).toMatchObject({
      ok: true,
      change: 0n,
    });
    expect(selectCoins(request(coins, "bnb"))).toMatchObject({ ok: true });
    expect(selectCoins({ ...request(coins, "bnb"), maxIterations: 0 })).toMatchObject({
      ok: false,
      reason: "search-exhausted",
    });
  });

  it("selects minimum input weight with CoinGrinder", () => {
    const coins = [
      utxo("heavy", 2_000n, { weight: inputWeight("p2pkh") }),
      utxo("light", 1_300n, { weight: inputWeight("p2tr") }),
    ];
    const result = selectCoinGrinder(request(coins, "coingrinder"));

    expect(result).toMatchObject({ ok: true, inputs: [{ txid: "light", vout: 0 }] });
  });

  it("makes randomized strategies reproducible", () => {
    const coins = [utxo("a", 700n), utxo("b", 800n), utxo("c", 900n), utxo("d", 2_000n)];
    const first = selectSingleRandomDraw(request(coins, "single-random-draw"));
    const second = selectCoins(request(coins, "single-random-draw"));

    expect(first).toEqual(second);
    expect(selectKnapsack(request(coins, "knapsack"))).toMatchObject({ ok: true });
  });

  it("runs the best meta-strategy at low and high fee rates", () => {
    expect(selectCoins(request([utxo("a", 5_000n)], "best"))).toMatchObject({
      ok: true,
    });
    const highFee = {
      ...request([utxo("a", 50_000n)], "best"),
      feeRate: 10,
      longTermFeeRate: 1,
    };

    expect(selectCoins(highFee)).toMatchObject({ ok: true });
  });

  it("applies required, excluded, frozen, and confirmation controls", () => {
    const coins = [
      utxo("required", 400n, { required: true }),
      utxo("excluded", 10_000n, { excluded: true }),
      utxo("frozen", 10_000n, { frozen: true }),
      utxo("unconfirmed", 10_000n, { confirmations: 0 }),
      utxo("usable", 2_000n, { confirmations: 2 }),
    ];
    const result = selectCoins({
      ...request(coins, "largest-first"),
      minConfirmations: 1,
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.inputs.map((coin) => `${coin.txid}:${String(coin.vout)}`)).toEqual([
        "required:0",
        "usable:0",
      ]);
    }
  });

  it("selects output groups atomically", () => {
    const coins = [
      utxo("group-a", 600n, { group: "same-address" }),
      utxo("group-b", 600n, { group: "same-address" }),
      utxo("other", 5_000n),
    ];
    const result = selectCoins({
      ...request(coins, "smallest-first"),
      avoidPartialSpends: true,
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.inputs.map((coin) => `${coin.txid}:${String(coin.vout)}`)).toEqual([
        "group-a:0",
        "group-b:0",
      ]);
    }
  });

  it("prefers a single script type when possible", () => {
    const coins = [
      utxo("segwit", 2_000n, { scriptType: "p2wpkh" }),
      utxo("legacy", 5_000n, { scriptType: "p2pkh" }),
    ];
    const result = selectCoins({
      ...request(coins, "best"),
      preferSingleScriptType: true,
    });

    expect(result).toMatchObject({ ok: true });
  });

  it("supports split/send-all and break denomination outputs", () => {
    const split = selectCoins({
      ...request([utxo("all", 5_000n)], "split"),
      targets: [{ value: 1_000n, weight: P2WPKH_OUT }, { weight: P2WPKH_OUT }],
    });

    expect(split.ok).toBe(true);

    if (split.ok) {
      expect(split.outputs.reduce((sum, output) => sum + output.value, 0n) + split.fee).toBe(
        5_000n,
      );
    }

    const broken = selectCoins({
      ...request([utxo("all", 5_000n)], "break"),
      targets: [{ value: 1_000n, weight: P2WPKH_OUT }],
    });

    expect(broken.ok).toBe(true);

    if (broken.ok) {
      expect(broken.outputs.length).toBeGreaterThan(1);
    }
  });

  it("returns failures when no strategy can fund a target", () => {
    for (const strategy of [
      "largest-first",
      "blackjack",
      "branch-and-bound",
      "coingrinder",
      "knapsack",
      "best",
    ] as const) {
      expect(selectCoins(request([utxo("low", 100n)], strategy))).toMatchObject({
        ok: false,
      });
    }
  });
});
