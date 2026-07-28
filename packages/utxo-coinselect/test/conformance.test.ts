import { describe, expect, it } from "vitest";

import coinSelectionVectors from "../../../test-vectors/coin-selection.json";
import weightVectors from "../../../test-vectors/weights.json";
import type { ChangePolicy, InputType, SelectionRequest, StrategyName, Utxo } from "../src/index";
import { inputWeight, selectCoins } from "../src/index";

describe("language-neutral conformance vectors", () => {
  for (const vector of weightVectors.weights) {
    it(`matches weight vector: ${vector.name}`, () => {
      expect(inputWeight(vector.inputType as InputType)).toBe(vector.expectedWeight);
    });
  }

  for (const vector of coinSelectionVectors.selections) {
    it(`matches selection vector: ${vector.name}`, () => {
      const targets = vector.targets.map((raw) => {
        const target: { weight: number; value: bigint } = {
          weight: raw.weight,
          value: BigInt(raw.value),
        };

        return target;
      });
      const [firstTarget] = targets;

      if (firstTarget === undefined) {
        throw new Error("selection vector requires a target");
      }

      const utxos = vector.utxos.map((coin): Utxo => {
        const utxo: {
          txid: string;
          vout: number;
          value: bigint;
          weight: number;
          required?: boolean;
          excluded?: boolean;
        } = {
          txid: coin.txid,
          vout: coin.vout,
          value: BigInt(coin.value),
          weight: coin.weight,
        };

        if ("required" in coin && coin.required) {
          utxo.required = true;
        }

        if ("excluded" in coin && coin.excluded) {
          utxo.excluded = true;
        }

        return utxo;
      });
      const request: {
        utxos: readonly Utxo[];
        targets: SelectionRequest["targets"];
        feeRate: number;
        longTermFeeRate: number;
        strategy: StrategyName;
        change: ChangePolicy;
        seed?: number;
      } = {
        utxos,
        targets: [firstTarget, ...targets.slice(1)],
        feeRate: vector.feeRate,
        longTermFeeRate: vector.longTermFeeRate,
        strategy: vector.strategy as StrategyName,
        change: vector.change,
      };

      if ("seed" in vector && typeof vector.seed === "number") {
        request.seed = vector.seed;
      }

      const result = selectCoins(request);

      if (!vector.expected.ok) {
        expect(result).toMatchObject({
          ok: false,
          reason: vector.expected.reason,
        });

        return;
      }

      expect(result.ok).toBe(true);

      if (!result.ok) {
        throw new Error(result.message);
      }

      const expected = vector.expected as {
        ok: true;
        inputs: readonly { txid: string; vout: number }[];
        fee: string;
        change: string;
        weight: number;
        strategy: StrategyName;
      };

      expect(result.inputs.map((coin) => ({ txid: coin.txid, vout: coin.vout }))).toEqual(
        expected.inputs,
      );
      expect(result.fee).toBe(BigInt(expected.fee));
      expect(result.change).toBe(BigInt(expected.change));
      expect(result.weight).toBe(expected.weight);
      expect(result.strategy).toBe(expected.strategy);
    });
  }
});
