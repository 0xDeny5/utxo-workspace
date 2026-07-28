import { describe, expect, it } from "vitest";

import weightVectors from "../../../test-vectors/weights.json";
import type { InputType, OutputType } from "../../utxo-coinselect/src/index";
import {
  inputWeight as coinselectInputWeight,
  outputWeight as coinselectOutputWeight,
} from "../../utxo-coinselect/src/index";
import { parseDescriptor } from "../src/parse";
import type { DescribedInput, DescribedOutput } from "../src/weights";
import { describeInput, describeOutput, inputWeight, outputWeight } from "../src/weights";

/**
 * Compile-time assignability guard: this only exists in the repo (never
 * published) and fails the build if `utxo-descriptors`'s described shapes
 * ever drift away from `utxo-coinselect`'s `InputType`/`OutputType` unions.
 */
function assertInputAssignable(value: DescribedInput): InputType {
  return value;
}

function assertOutputAssignable(value: DescribedOutput): OutputType {
  return value;
}

describe("cross-package weight agreement", () => {
  for (const vector of weightVectors.weights) {
    if (!("descriptor" in vector)) {
      continue;
    }

    it(`agrees with utxo-coinselect for: ${vector.name}`, () => {
      const parsed = parseDescriptor(vector.descriptor);

      if (!parsed.ok) {
        throw new Error(`expected ${vector.descriptor} to parse: ${parsed.message}`);
      }

      const script = parsed.descriptor.script;
      const descriptorWeight = inputWeight(script);
      const described = describeInput(script);

      expect(descriptorWeight).toEqual({ ok: true, weight: vector.expectedWeight });
      expect(described.ok).toBe(true);

      if (!described.ok) {
        throw new Error(described.message);
      }

      const coinselectWeight = coinselectInputWeight(assertInputAssignable(described.description));

      expect(descriptorWeight).toEqual({ ok: true, weight: coinselectWeight });
    });
  }

  it("agrees with utxo-coinselect for basic output script types", () => {
    const cases: readonly string[] = [
      "pk(02cb674fe0ea2e1e8f79a4e518b8b8ecdff7869f93998fd985637e1317e856da07)",
      "pkh(02cb674fe0ea2e1e8f79a4e518b8b8ecdff7869f93998fd985637e1317e856da07)",
      "wpkh(02cb674fe0ea2e1e8f79a4e518b8b8ecdff7869f93998fd985637e1317e856da07)",
      "sh(wpkh(02cb674fe0ea2e1e8f79a4e518b8b8ecdff7869f93998fd985637e1317e856da07))",
      "wsh(pk(02cb674fe0ea2e1e8f79a4e518b8b8ecdff7869f93998fd985637e1317e856da07))",
      "tr(63cc121461f39de77043ee0583d261de1381f75dd10ac1fc6a95b8ff20994729)",
    ];

    for (const descriptor of cases) {
      const parsed = parseDescriptor(descriptor);

      if (!parsed.ok) {
        throw new Error(`expected ${descriptor} to parse: ${parsed.message}`);
      }

      const descriptorWeight = outputWeight(parsed.descriptor.script);
      const described = describeOutput(parsed.descriptor.script);

      expect(described.ok).toBe(true);

      if (!described.ok) {
        throw new Error(described.message);
      }

      const coinselectWeight = coinselectOutputWeight(
        assertOutputAssignable(described.description),
      );

      expect(descriptorWeight).toEqual({ ok: true, weight: coinselectWeight });
    }
  });
});
