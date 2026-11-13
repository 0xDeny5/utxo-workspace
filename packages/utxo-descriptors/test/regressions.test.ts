import { describe, expect, it } from "vitest";

import {
  inputWeight as coinselectInputWeight,
  outputWeight as coinselectOutputWeight,
  P2WSH_MULTISIG,
} from "../../utxo-coinselect/src/index";
import { bech32Decode, convertBits } from "../src/bech32";
import { BITCOIN_REGTEST, BITCOIN_TESTNET } from "../src/chains";
import { parseDescriptor } from "../src/parse";
import type { ScriptNode } from "../src/types";
import { describeInput, describeOutput, inputWeight, outputWeight } from "../src/weights";
import { bech32Encode } from "./helpers/bech32";

const XONLY = "63cc121461f39de77043ee0583d261de1381f75dd10ac1fc6a95b8ff20994729";
const UNCOMPRESSED = `04${"11".repeat(64)}`;
const UNCOMPRESSED_WIF = "5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ";
const XPUB =
  "xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL";

function compressedKeys(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `02${(index + 1).toString(16).padStart(64, "0")}`,
  );
}

function script(descriptor: string): ScriptNode {
  const parsed = parseDescriptor(descriptor);

  if (!parsed.ok) {
    throw new Error(`${descriptor}: ${parsed.message}`);
  }

  return parsed.descriptor.script;
}

function weightOf(result: ReturnType<typeof inputWeight>): number {
  if (!result.ok) {
    throw new Error(result.message);
  }

  return result.weight;
}

function words(bytes: number): number[] {
  return (
    convertBits(
      Array.from({ length: bytes }, (_, index) => index),
      8,
      5,
      true,
    ) ?? []
  );
}

describe("multisig with more than 16 keys", () => {
  it("agrees with utxo-coinselect when OP_n needs a 2-byte push", () => {
    const node = script(`wsh(multi(17,${compressedKeys(17).join(",")}))`);

    expect(weightOf(inputWeight(node))).toBe(coinselectInputWeight(P2WSH_MULTISIG(17, 17)));
    expect(weightOf(inputWeight(node))).toBe(2_010);
    expect(describeInput(node)).toEqual({
      ok: true,
      description: { type: "p2wsh-multisig", m: 17, n: 17 },
    });
  });
});

describe("uncompressed keys are never described as compressed catalog entries", () => {
  it.each([
    `pk(${UNCOMPRESSED})`,
    `pkh(${UNCOMPRESSED})`,
    `sh(multi(1,${UNCOMPRESSED},${compressedKeys(1).join("")}))`,
    `sh(pkh(${UNCOMPRESSED_WIF}))`,
  ])("%s prices identically in both packages", (descriptor) => {
    const node = script(descriptor);
    const description = describeInput(node);

    expect(description).toMatchObject({ ok: true, description: { type: "raw" } });
    expect(description.ok && coinselectInputWeight(description.description)).toBe(
      weightOf(inputWeight(node)),
    );
  });

  it("describes an uncompressed pk() output by its exact size", () => {
    const node = script(`pk(${UNCOMPRESSED})`);
    const description = describeOutput(node);

    expect(description).toEqual({ ok: true, description: { type: "raw", scriptPubKeyBytes: 67 } });
    expect(description.ok && coinselectOutputWeight(description.description)).toBe(
      weightOf(outputWeight(node)),
    );
    expect(describeOutput(script(`pk(${compressedKeys(1).join("")})`))).toEqual({
      ok: true,
      description: "p2pk",
    });
  });
});

describe("BIP-386 tr() rules", () => {
  it.each([
    `tr(${UNCOMPRESSED})`,
    `tr(${UNCOMPRESSED_WIF})`,
    `tr(${XONLY},pk(${UNCOMPRESSED}))`,
    `tr(${XONLY},{pk(${XONLY}),pk(${UNCOMPRESSED_WIF})})`,
  ])("rejects uncompressed keys in %s", (descriptor) => {
    expect(parseDescriptor(descriptor)).toMatchObject({
      ok: false,
      reason: "invalid-key-expression",
      message: expect.stringContaining("uncompressed") as unknown,
    });
  });

  it("limits the tapscript tree to 128 levels", () => {
    const leaf = `pk(${XONLY})`;
    const nest = (depth: number): string => {
      let tree = leaf;

      for (let level = 0; level < depth; level += 1) {
        tree = `{${tree},${leaf}}`;
      }

      return `tr(${XONLY},${tree})`;
    };

    expect(parseDescriptor(nest(128)).ok).toBe(true);
    expect(parseDescriptor(nest(129))).toMatchObject({
      ok: false,
      reason: "invalid-context",
      message: expect.stringContaining("128") as unknown,
    });
  });
});

describe("P2SH redeemScript size", () => {
  const uncompressed = (count: number): string =>
    Array.from({ length: count }, () => UNCOMPRESSED).join(",");

  it("rejects sh(multi()) whose redeemScript exceeds 520 bytes", () => {
    expect(parseDescriptor(`sh(multi(1,${uncompressed(7)}))`).ok).toBe(true);
    expect(parseDescriptor(`sh(multi(1,${uncompressed(8)}))`)).toMatchObject({
      ok: false,
      reason: "key-count-exceeded",
      message: expect.stringContaining("520") as unknown,
    });
    expect(parseDescriptor(`sh(multi(1,${compressedKeys(15).join(",")}))`).ok).toBe(true);
  });
});

describe("BIP-389 multipath", () => {
  it("rejects more than one multipath specifier in a key", () => {
    expect(parseDescriptor(`wpkh(${XPUB}/<0;1>/<2;3>/*)`)).toMatchObject({
      ok: false,
      reason: "invalid-key-expression",
    });
    expect(parseDescriptor(`wpkh(${XPUB}/<0;1>/*)`).ok).toBe(true);
  });
});

describe("addr() validation", () => {
  const p2wpkh = (hrp: string): string => bech32Encode(hrp, [0, ...words(20)], false);

  it("checks the bech32 prefix against the chain", () => {
    const testnet = script(`addr(${p2wpkh("tb")})`);
    const regtest = script(`addr(${p2wpkh("bcrt")})`);

    expect(outputWeight(testnet)).toMatchObject({
      ok: false,
      reason: "unsupported",
      message: expect.stringContaining("'tb'") as unknown,
    });
    expect(outputWeight(testnet, { chain: BITCOIN_TESTNET })).toEqual({ ok: true, weight: 124 });
    expect(outputWeight(regtest, { chain: BITCOIN_REGTEST })).toEqual({ ok: true, weight: 124 });
    expect(describeOutput(regtest)).toMatchObject({ ok: false, reason: "unsupported" });
  });

  it("rejects witness versions above 16 and malformed v0 programs", () => {
    expect(bech32Decode(bech32Encode("bc", [16, ...words(32)], true))).toBeDefined();
    expect(bech32Decode(bech32Encode("bc", [17, ...words(32)], true))).toBeUndefined();
    expect(bech32Decode(bech32Encode("bc", [0, ...words(32)], false))).toBeDefined();
    expect(bech32Decode(bech32Encode("bc", [0, ...words(25)], false))).toBeUndefined();
  });

  it("rejects addresses longer than 90 characters", () => {
    expect(bech32Decode(bech32Encode("bc", [1, ...words(40)], true))).toBeDefined();
    expect(bech32Decode(bech32Encode("a".repeat(30), [1, ...words(40)], true))).toBeUndefined();
  });
});
