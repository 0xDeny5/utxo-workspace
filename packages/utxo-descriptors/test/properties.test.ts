import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { checksumCreate, checksumVerify } from "../src/checksum";
import { expandMultipath } from "../src/multipath";
import { parseDescriptor } from "../src/parse";
import type { ScriptNode } from "../src/types";
import { inputWeight } from "../src/weights";

const KEY_A = "02cb674fe0ea2e1e8f79a4e518b8b8ecdff7869f93998fd985637e1317e856da07";
const KEY_B = "03ec2566e4d0b33ed59d5b0ee8c4d0628a776d9d380ac877cfef116d7b6b54c867";
const XPUB =
  "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8";
/** The descriptor charset, drawn from BIP-380's `INPUT_CHARSET`. */
const descriptorCharset = "0123456789()[],'/*abcdefghIJKLMNOPQRSTUVWXYZijklmnopqrstuvwxyzABCDEFGH";
const descriptorCharacters = Array.from(descriptorCharset);

function inCharsetString(minLength: number, maxLength: number): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...descriptorCharacters), { minLength, maxLength })
    .map((chars) => chars.join(""));
}

describe("checksum properties", () => {
  it("create-then-verify round-trips for any in-charset script", () => {
    fc.assert(
      fc.property(inCharsetString(1, 80), (script) => {
        const checksum = checksumCreate(script);

        if (checksum === undefined) {
          return;
        }

        expect(checksumVerify(script, checksum)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

describe("parseDescriptor properties", () => {
  it("is total: it never throws on arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (text) => {
        expect(() => parseDescriptor(text)).not.toThrow();
      }),
      { numRuns: 500 },
    );
  });

  it("is total on strings drawn only from the descriptor charset", () => {
    fc.assert(
      fc.property(inCharsetString(0, 120), (text) => {
        expect(() => parseDescriptor(text)).not.toThrow();
      }),
      { numRuns: 500 },
    );
  });
});

describe("expandMultipath properties", () => {
  it("preserves the tuple length across every expanded descriptor", () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.integer({ min: 0, max: 20 }), { minLength: 2, maxLength: 5 })
          .filter((values) => new Set(values).size === values.length),
        (values) => {
          const tuple = values.map((value) => String(value)).join(";");
          const result = parseDescriptor(`wpkh(${XPUB}/<${tuple}>/*)`);

          if (!result.ok) {
            throw new Error(result.message);
          }

          const expanded = expandMultipath(result.descriptor.script);

          expect(expanded.ok).toBe(true);

          if (expanded.ok) {
            expect(expanded.descriptors).toHaveLength(values.length);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("weight properties", () => {
  it("multisig input weight is monotonic in n for a fixed threshold", () => {
    const keys = [KEY_A, KEY_B];

    fc.assert(
      fc.property(fc.integer({ min: 2, max: 14 }), (n) => {
        const script: ScriptNode = {
          kind: "multi",
          threshold: 1,
          sorted: false,
          keys: Array.from({ length: n }, (_, index) => {
            const keyHex = keys[index % keys.length] ?? KEY_A;
            const parsed = parseDescriptor(`pk(${keyHex})`);

            if (!parsed.ok || parsed.descriptor.script.kind !== "pk") {
              throw new Error("expected a pk() node");
            }

            return parsed.descriptor.script.key;
          }),
        };
        const wrapped: ScriptNode = { kind: "wsh", inner: script };
        const smaller: ScriptNode = {
          kind: "wsh",
          inner: { ...script, keys: script.keys.slice(0, -1) },
        };
        const larger = inputWeight(wrapped);
        const fewer = inputWeight(smaller);

        expect(larger.ok && fewer.ok && larger.weight >= fewer.weight).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
