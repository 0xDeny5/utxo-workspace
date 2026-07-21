import { describe, expect, it } from "vitest";

import type {
  ChangePolicy,
  SelectionRequest,
  SelectionSuccess,
  StrategyName,
  Utxo,
} from "../src/index";
import {
  betterResult,
  compactSizeBytes,
  finalizeSelection,
  inputWeight,
  outputWeight,
  P2SH_MULTISIG,
  selectCoinGrinder,
  selectCoins,
  selectionTarget,
  selectSingleRandomDraw,
  sumWeights,
  targetValue,
} from "../src/index";

const inWeight = inputWeight("p2wpkh");
const outWeight = outputWeight("p2wpkh");
const changePolicy: ChangePolicy = { outputWeight: outWeight, spendWeight: inWeight };
const coin = (label: string, value: bigint, overrides: Partial<Utxo> = {}): Utxo => {
  const colon = label.lastIndexOf(":");
  const txid = colon === -1 ? label : label.slice(0, colon);
  const parsed = colon === -1 ? 0 : Number(label.slice(colon + 1));
  const vout = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;

  return {
    txid,
    vout,
    value,
    weight: inWeight,
    ...overrides,
  };
};

const makeRequest = (utxos: readonly Utxo[], strategy?: StrategyName): SelectionRequest => {
  const request: {
    utxos: readonly Utxo[];
    targets: SelectionRequest["targets"];
    feeRate: number;
    change: ChangePolicy;
    strategy?: StrategyName;
  } = {
    utxos,
    targets: [{ value: 1_000n, weight: outWeight }],
    feeRate: 1,
    change: changePolicy,
  };

  if (strategy) {
    request.strategy = strategy;
  }

  return request;
};

function success(overrides: Partial<SelectionSuccess> = {}): SelectionSuccess {
  return {
    ok: true,
    inputs: [coin("a", 2_000n)],
    outputs: [{ value: 1_000n, weight: outWeight, isChange: false }],
    fee: 100n,
    change: 0n,
    waste: 10n,
    weight: 400,
    strategy: "largest-first",
    ...overrides,
  };
}

describe("coverage of comparison and arithmetic edges", () => {
  it("covers every deterministic result tie-break", () => {
    const base = success();

    expect(betterResult(undefined, base)).toBe(base);
    expect(betterResult(base, success({ waste: 9n })).waste).toBe(9n);
    expect(betterResult(base, success({ waste: 11n }))).toBe(base);
    expect(betterResult(base, success({ fee: 99n })).fee).toBe(99n);
    expect(betterResult(base, success({ fee: 101n }))).toBe(base);
    expect(
      betterResult(base, success({ inputs: [coin("a", 1n), coin("b", 1n)] })).inputs,
    ).toHaveLength(2);
    expect(betterResult(base, success({ inputs: [] }))).toBe(base);
    expect(betterResult(base, success({ weight: 399 })).weight).toBe(399);
    expect(betterResult(base, success({ weight: 401 }))).toBe(base);
  });

  it("handles open target values and partial output overrides", () => {
    const splitRequest: SelectionRequest = {
      ...makeRequest([coin("a", 5_000n)], "split"),
      targets: [{ value: 100n, weight: outWeight }, { weight: outWeight }],
    };

    expect(targetValue(splitRequest.targets)).toBe(100n);
    expect(selectionTarget(splitRequest)).toBeGreaterThan(100n);
    expect(sumWeights(splitRequest.utxos)).toBe(inWeight);
    const finalized = finalizeSelection(
      {
        ...splitRequest,
        targets: [
          { value: 100n, weight: outWeight },
          { value: 200n, weight: outWeight },
        ],
      },
      splitRequest.utxos,
      "split",
      [300n],
    );

    expect(finalized).toMatchObject({ ok: true });
  });

  it("covers remaining CompactSize and pushdata boundaries", () => {
    expect(() => compactSizeBytes(-1n)).toThrow("negative");
    expect(inputWeight({ ...P2SH_MULTISIG(1, 1), signatureBytes: 300 })).toBeGreaterThan(1_000);
    expect(inputWeight({ ...P2SH_MULTISIG(1, 1), signatureBytes: 70_000 })).toBeGreaterThan(
      280_000,
    );
  });
});

describe("coverage of strategy edge paths", () => {
  it("returns immediately when required coins already fund the payment", () => {
    const required = coin("required", 1_110n, { required: true });

    expect(selectCoins(makeRequest([required], "largest-first"))).toMatchObject({
      ok: true,
      inputs: [{ txid: "required", vout: 0 }],
    });
    expect(selectCoins(makeRequest([required], "blackjack"))).toMatchObject({
      ok: true,
      change: 0n,
    });
  });

  it("orders by confirmations and stable identifiers without timestamps", () => {
    const coins = [
      coin("b", 2_000n, { confirmations: 2 }),
      coin("a", 2_000n, { confirmations: 10 }),
    ];

    expect(selectCoins(makeRequest(coins, "oldest-first"))).toMatchObject({
      ok: true,
      inputs: [{ txid: "a", vout: 0 }],
    });
    expect(selectCoins(makeRequest(coins, "newest-first"))).toMatchObject({
      ok: true,
      inputs: [{ txid: "b", vout: 0 }],
    });
    const tied = coins.map((item) => ({ ...item, confirmations: 1 }));

    expect(selectCoins(makeRequest(tied, "oldest-first"))).toMatchObject({
      inputs: [{ txid: "a", vout: 0 }],
    });
    expect(selectCoins(makeRequest(tied, "newest-first"))).toMatchObject({
      inputs: [{ txid: "b", vout: 0 }],
    });
  });

  it("handles mixed grouped script types and pruned selection without change", () => {
    const grouped = [
      coin("a", 700n, { group: "g", scriptType: "p2wpkh" }),
      coin("b", 700n, { group: "g", scriptType: "p2tr" }),
    ];

    expect(
      selectCoins({
        ...makeRequest(grouped, "smallest-first"),
        avoidPartialSpends: true,
      }),
    ).toMatchObject({ ok: true });
    const { change: _change, ...withoutChange } = makeRequest(
      [coin("dust", 100n), coin("fund", 2_000n)],
      "pruned-fifo",
    );

    expect(selectCoins(withoutChange)).toMatchObject({ ok: true });
  });

  it("covers exact matrix success and Blackjack without a change policy", () => {
    expect(
      selectCoins(makeRequest([coin("exact", 1_110n)], "exact-biggest/accum-smallest")),
    ).toMatchObject({ ok: true, change: 0n });
    const { change: _change, ...withoutChange } = makeRequest([coin("exact", 1_110n)], "blackjack");

    expect(selectCoins(withoutChange)).toMatchObject({ ok: true, change: 0n });
    expect(
      selectCoins({
        ...makeRequest([coin("change", 5_000n)], "blackjack"),
        change: {
          outputWeight: outWeight,
          spendWeight: 20_000,
          dustThreshold: 1n,
        },
      }),
    ).toMatchObject({ ok: false });
  });

  it("covers BnB clone pruning, bounds, and finalization rejection", () => {
    const cloneFailure = selectCoins(
      makeRequest([coin("a", 500n), coin("b", 500n), coin("c", 500n)], "branch-and-bound"),
    );

    expect(cloneFailure.ok).toBe(false);
    const equalEffectiveDifferentWeight = [
      coin("a", 500n, { weight: 272 }),
      coin("b", 600n, { weight: 672 }),
    ];

    expect(selectCoins(makeRequest(equalEffectiveDifferentWeight, "branch-and-bound")).ok).toBe(
      false,
    );
    expect(
      selectCoins({
        ...makeRequest(
          [
            coin("a", 500n, { weight: 272 }),
            coin("b", 600n, { weight: 672 }),
            coin("c", 500n, { weight: 272 }),
          ],
          "branch-and-bound",
        ),
        targets: [{ value: 500n, weight: outWeight }],
      }).ok,
    ).toBe(false);
    expect(
      selectCoins({
        ...makeRequest([coin("exact", 1_110n)], "branch-and-bound"),
        maxWeight: 100,
      }),
    ).toMatchObject({ ok: false });
    expect(
      selectCoins({
        ...makeRequest(
          [coin("required", 100n, { required: true }), coin("exact", 1_078n)],
          "branch-and-bound",
        ),
      }),
    ).toMatchObject({ ok: true });
  });

  it("covers CoinGrinder limits, pruning, and rejected candidates", () => {
    expect(
      selectCoinGrinder({
        ...makeRequest([coin("a", 2_000n)], "coingrinder"),
        maxIterations: 0,
      }),
    ).toMatchObject({ ok: false, reason: "search-exhausted" });
    expect(
      selectCoinGrinder({
        ...makeRequest([coin("a", 2_000n)], "coingrinder"),
        maxWeight: 100,
      }),
    ).toMatchObject({ ok: false });
    expect(
      selectCoinGrinder(
        makeRequest(
          [coin("heavy", 2_000n, { weight: 1_000 }), coin("light", 1_500n)],
          "coingrinder",
        ),
      ),
    ).toMatchObject({ ok: true, inputs: [{ txid: "light", vout: 0 }] });
    expect(
      selectCoinGrinder(
        makeRequest(
          [
            coin("required", 100n, { required: true }),
            coin("a", 1_100n),
            coin("b", 900n),
            coin("c", 800n),
          ],
          "coingrinder",
        ),
      ),
    ).toMatchObject({ ok: true });
  });

  it("covers SRD alias and default options", () => {
    expect(selectSingleRandomDraw(makeRequest([coin("a", 2_000n)], "srd"))).toMatchObject({
      ok: true,
      strategy: "srd",
    });
    expect(selectCoins(makeRequest([coin("a", 2_000n)]))).toMatchObject({ ok: true });
    const noLongTerm = makeRequest([coin("a", 5_000n)]);

    expect(selectCoins(noLongTerm)).toMatchObject({ ok: true });
  });

  it("reports split and break edge cases", () => {
    expect(
      selectCoins({
        ...makeRequest([coin("a", 2_000n)], "split"),
        targets: [{ value: 100n, weight: outWeight }],
      }),
    ).toMatchObject({ ok: false });
    expect(
      selectCoins({
        ...makeRequest([], "split"),
        targets: [{ weight: outWeight }],
      }),
    ).toMatchObject({ ok: false });
    expect(
      selectCoins({
        ...makeRequest([coin("a", 500n)], "split"),
        targets: [{ value: 1_000n, weight: outWeight }, { weight: outWeight }],
      }),
    ).toMatchObject({ ok: false });
    expect(
      selectCoins({
        ...makeRequest([coin("a", 2_000n)], "break"),
        targets: [{ value: 0n, weight: outWeight }],
      }),
    ).toMatchObject({ ok: false, reason: "invalid-request" });
    expect(
      selectCoins({
        ...makeRequest([coin("a", 500n)], "break"),
        targets: [{ value: 1_000n, weight: outWeight }],
      }),
    ).toMatchObject({ ok: false });
    const metadata = selectCoins({
      ...makeRequest([coin("a", 5_000n)], "break"),
      targets: [{ value: 1_000n, weight: outWeight, meta: "denomination" }],
    });

    expect(metadata).toMatchObject({ ok: true });
  });

  it("falls back from homogeneous script pools to a mixed selection", () => {
    const result = selectCoins({
      ...makeRequest(
        [coin("a", 700n, { scriptType: "p2wpkh" }), coin("b", 700n, { scriptType: "p2tr" })],
        "largest-first",
      ),
      preferSingleScriptType: true,
    });

    expect(result).toMatchObject({ ok: true });

    if (result.ok) {
      expect(result.inputs).toHaveLength(2);
    }
  });
});
