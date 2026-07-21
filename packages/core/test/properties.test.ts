import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { effectiveValue, feeForWeight, inputWeight, outputWeight, selectCoins } from "../src/index";

const input = inputWeight("p2wpkh");
const output = outputWeight("p2wpkh");

describe("coin-selection properties", () => {
  it("never creates value or underpays the calculated fee", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 500, max: 1_000_000 }), {
          minLength: 1,
          maxLength: 30,
        }),
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 100 }),
        (values, target, feeRate) => {
          const result = selectCoins({
            utxos: values.map((value, index) => ({
              txid: String(index),
              vout: 0,
              value: BigInt(value),
              weight: input,
            })),
            targets: [{ value: BigInt(target), weight: output }],
            feeRate,
            change: { outputWeight: output, spendWeight: input },
            strategy: "largest-first",
          });

          if (!result.ok) {
            return;
          }

          const inputValue = result.inputs.reduce((sum, coin) => sum + coin.value, 0n);
          const outputValue = result.outputs.reduce(
            (sum, targetOutput) => sum + targetOutput.value,
            0n,
          );

          expect(inputValue).toBe(outputValue + result.fee);
          expect(result.fee).toBeGreaterThanOrEqual(feeForWeight(result.weight, feeRate));
          expect(result.change).toBeGreaterThanOrEqual(0n);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("effective value decreases monotonically as the fee rate rises", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 21_000_000 * 100_000_000 }),
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: 0, max: 1_000 }),
        fc.integer({ min: 0, max: 1_000 }),
        (value, weight, firstRate, secondRate) => {
          const low = Math.min(firstRate, secondRate);
          const high = Math.max(firstRate, secondRate);
          const coin = { txid: "coin", vout: 0, value: BigInt(value), weight };

          expect(effectiveValue(coin, high)).toBeLessThanOrEqual(effectiveValue(coin, low));
        },
      ),
      { numRuns: 500 },
    );
  });

  it("randomized strategies are deterministic for a fixed seed", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1_000, max: 100_000 }), {
          minLength: 2,
          maxLength: 20,
        }),
        fc.integer(),
        (values, seed) => {
          const request = {
            utxos: values.map((value, index) => ({
              txid: String(index),
              vout: 0,
              value: BigInt(value),
              weight: input,
            })),
            targets: [{ value: 5_000n, weight: output }] as const,
            feeRate: 2,
            strategy: "single-random-draw" as const,
            seed,
          };

          expect(selectCoins(request)).toEqual(selectCoins(request));
        },
      ),
      { numRuns: 200 },
    );
  });
});
