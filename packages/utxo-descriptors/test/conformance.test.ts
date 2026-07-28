import { describe, expect, it } from "vitest";

import descriptorVectors from "../../../test-vectors/descriptors.json";
import weightVectors from "../../../test-vectors/weights.json";
import { parseDescriptor } from "../src/parse";
import type { ParseFailureReason } from "../src/types";
import { inputWeight } from "../src/weights";

describe("language-neutral conformance vectors: parsing", () => {
  for (const vector of descriptorVectors.descriptors) {
    it(`matches descriptor vector: ${vector.name}`, () => {
      const result = parseDescriptor(vector.descriptor);

      if (vector.expected.ok) {
        expect(result.ok).toBe(true);

        return;
      }

      const expected = vector.expected as {
        readonly ok: false;
        readonly reason: ParseFailureReason;
      };

      expect(result).toMatchObject({ ok: false, reason: expected.reason });
    });
  }
});

describe("language-neutral conformance vectors: weights", () => {
  for (const vector of weightVectors.weights) {
    if (!("descriptor" in vector)) {
      continue;
    }

    it(`matches weight vector via descriptor: ${vector.name}`, () => {
      const parsed = parseDescriptor(vector.descriptor);

      if (!parsed.ok) {
        throw new Error(`expected ${vector.descriptor} to parse: ${parsed.message}`);
      }

      expect(inputWeight(parsed.descriptor.script)).toEqual({
        ok: true,
        weight: vector.expectedWeight,
      });
    });
  }
});
