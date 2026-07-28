import { describe, expect, it } from "vitest";

import { base58Decode } from "../src/base58";
import { bech32Decode, convertBits } from "../src/bech32";
import { parseDescriptor } from "../src/parse";
import type { ScriptNode } from "../src/types";
import { compactSizeBytes, inputWeight, outputWeight, pushDataPrefixBytes } from "../src/weights";

const KEY_A = "02cb674fe0ea2e1e8f79a4e518b8b8ecdff7869f93998fd985637e1317e856da07";
const KEY_B = "03ec2566e4d0b33ed59d5b0ee8c4d0628a776d9d380ac877cfef116d7b6b54c867";
const XONLY_A = "63cc121461f39de77043ee0583d261de1381f75dd10ac1fc6a95b8ff20994729";
const UNCOMPRESSED_KEY =
  "04678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5f";
const UNCOMPRESSED_WIF = "5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ";
const XPUB =
  "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8";
const XPRV =
  "xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPTZq9hkLNBd8UBk3jaJHVKG5Kf4M6mFTBoRAKzGiRhLmZ7ceabRt8Kbwv";
const WRONG_VERSION_XPUB =
  "xpub661AyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8";

function expectParseFailure(descriptor: string, reason: string): void {
  const result = parseDescriptor(descriptor);

  expect(result).toMatchObject({ ok: false, reason });
}

/**
 * A minimal bech32/bech32m encoder, kept local to this test file, used only
 * to construct the malformed addresses needed to exercise `bech32Decode`'s
 * defensive branches (invalid character, invalid checksum, missing witness
 * version, wrong constant for the version, and program-length bounds).
 */
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function bech32Polymod(values: readonly number[]): number {
  let checksum = 1;

  for (const value of values) {
    const top = checksum >>> 25;

    checksum = ((checksum & 0x1ffffff) << 5) ^ value;

    for (const [bit, generatorValue] of BECH32_GENERATOR.entries()) {
      if (((top >>> bit) & 1) === 1) {
        checksum ^= generatorValue;
      }
    }
  }

  return checksum >>> 0;
}

function bech32HrpExpand(hrp: string): number[] {
  const high = Array.from(hrp, (char) => (char.codePointAt(0) ?? 0) >> 5);
  const low = Array.from(hrp, (char) => (char.codePointAt(0) ?? 0) & 31);

  return [...high, 0, ...low];
}

function bech32Encode(hrp: string, words: readonly number[], useBech32m: boolean): string {
  const targetConst = useBech32m ? 0x2bc830a3 : 1;
  const polymodInput = [...bech32HrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0];
  const mod = bech32Polymod(polymodInput) ^ targetConst;
  const checksumWords = Array.from({ length: 6 }, (_, index) => (mod >>> (5 * (5 - index))) & 31);
  const dataChars = [...words, ...checksumWords].map((word) => BECH32_CHARSET[word] ?? "").join("");

  return `${hrp}1${dataChars}`;
}

describe("base58 and bech32 edge cases", () => {
  it("rejects an empty base58 string", () => {
    expect(base58Decode("")).toBeUndefined();
  });

  it("classifies an uncompressed WIF key", () => {
    const result = parseDescriptor(`pkh(${UNCOMPRESSED_WIF})`);

    expect(result).toMatchObject({
      ok: true,
      descriptor: { script: { key: { kind: "wif-uncompressed" } } },
    });
  });

  it("classifies a valid xprv key", () => {
    const result = parseDescriptor(`wpkh(${XPRV})`);

    expect(result).toMatchObject({ ok: true, descriptor: { script: { key: { kind: "xprv" } } } });
  });

  it("rejects an xpub-prefixed string whose version bytes do not match", () => {
    expectParseFailure(`wpkh(${WRONG_VERSION_XPUB})`, "invalid-key-expression");
  });

  it("rejects an xpub-prefixed string that is not valid base58", () => {
    expectParseFailure(
      "wpkh(xpub0invalidbase58charhere0000000000000000000000000000000000000000000000000000000000000000)",
      "invalid-key-expression",
    );
  });

  it("parses a non-ranged multi-segment derivation path", () => {
    const result = parseDescriptor(`wpkh(${XPUB}/0/1)`);

    expect(result).toMatchObject({
      ok: true,
      descriptor: {
        script: {
          key: {
            path: [
              { kind: "step", index: 0 },
              { kind: "step", index: 1 },
            ],
          },
        },
      },
    });
  });

  it("rejects an out-of-charset bech32 witness version character directly", () => {
    expect(bech32Decode("bc1!invalid")).toBeUndefined();
  });

  it("exercises convertBits's bounds directly", () => {
    expect(convertBits([32], 5, 8, false)).toBeUndefined();
    expect(convertBits([1, 1], 5, 8, true)).toEqual([8, 64]);
    expect(convertBits([1, 1, 1], 5, 8, false)).toBeUndefined();
    expect(convertBits([1, 1, 0, 1], 5, 8, false)).toBeUndefined();
  });

  it("rejects a data character outside the bech32 charset", () => {
    const validProgram =
      convertBits(
        Array.from({ length: 20 }, () => 0),
        8,
        5,
        true,
      ) ?? [];
    const address = bech32Encode("bc", [0, ...validProgram], false);
    const corrupted = `${address.slice(0, address.indexOf("1") + 1)}b${address.slice(address.indexOf("1") + 2)}`;

    expect(bech32Decode(corrupted)).toBeUndefined();
  });

  it("rejects a tampered checksum", () => {
    const validProgram =
      convertBits(
        Array.from({ length: 20 }, () => 0),
        8,
        5,
        true,
      ) ?? [];
    const address = bech32Encode("bc", [0, ...validProgram], false);
    const lastChar = address.endsWith("q") ? "p" : "q";
    const tampered = `${address.slice(0, -1)}${lastChar}`;

    expect(bech32Decode(tampered)).toBeUndefined();
  });

  it("rejects an address with no witness version (empty data)", () => {
    const address = bech32Encode("bc", [], false);

    expect(bech32Decode(address)).toBeUndefined();
  });

  it("rejects witness version 0 encoded with the bech32m constant", () => {
    const validProgram =
      convertBits(
        Array.from({ length: 20 }, () => 0),
        8,
        5,
        true,
      ) ?? [];
    const address = bech32Encode("bc", [0, ...validProgram], true);

    expect(bech32Decode(address)).toBeUndefined();
  });

  it("rejects a non-zero witness version encoded with the plain bech32 constant", () => {
    const validProgram =
      convertBits(
        Array.from({ length: 20 }, () => 0),
        8,
        5,
        true,
      ) ?? [];
    const address = bech32Encode("bc", [1, ...validProgram], false);

    expect(bech32Decode(address)).toBeUndefined();
  });

  it("rejects a witness program shorter than 2 bytes", () => {
    const shortProgram = convertBits([0xab], 8, 5, true) ?? [];
    const address = bech32Encode("bc", [0, ...shortProgram], false);

    expect(bech32Decode(address)).toBeUndefined();
  });

  it("rejects a witness program longer than 40 bytes", () => {
    const longProgram =
      convertBits(
        Array.from({ length: 41 }, () => 0),
        8,
        5,
        true,
      ) ?? [];
    const address = bech32Encode("bc", [1, ...longProgram], true);

    expect(bech32Decode(address)).toBeUndefined();
  });
});

describe("parse.ts: end-of-input and unclosed-expression paths", () => {
  it.each([
    ["pk((", "unexpected-token"],
    ["multi(", "unexpected-token"],
    [`multi(notanumber,${KEY_A})`, "unexpected-token"],
    [`multi(1,${KEY_A}`, "unexpected-token"],
    ["multi(1)", "unexpected-token"],
    [`multi(1,notakey)`, "invalid-key-expression"],
    [`wsh(multi(1,${UNCOMPRESSED_KEY}))`, "invalid-key-expression"],
    [`tr(${XONLY_A},`, "unexpected-token"],
    [`tr(${XONLY_A},pk,${XONLY_A})`, "unexpected-token"],
    [`tr(${XONLY_A},pk(notakey))`, "invalid-key-expression"],
    [`tr(${XONLY_A},pk(${XONLY_A}`, "unexpected-token"],
    [`tr(${XONLY_A},{pk(notakey),pk(${XONLY_A})})`, "invalid-key-expression"],
    [`tr(${XONLY_A},{pk(${XONLY_A})pk(${XONLY_A})})`, "unexpected-token"],
    [`tr(${XONLY_A},{pk(${XONLY_A}),pk(notakey)})`, "invalid-key-expression"],
    [`tr(${XONLY_A},{pk(${XONLY_A}),pk(${XONLY_A})`, "unexpected-token"],
    [`tr(${XONLY_A},{pk(${XONLY_A}),pk(${XONLY_A})}`, "unexpected-token"],
    ["tr(notakey)", "invalid-key-expression"],
    [`tr(${XONLY_A}{${XONLY_A})`, "unexpected-token"],
    [`tr(${XONLY_A},pk(${XONLY_A}))`.slice(0, -1), "unexpected-token"],
    ["raw(", "unexpected-token"],
    ["raw(deadbeef", "unexpected-token"],
    ["addr()", "unexpected-token"],
    ["addr(bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", "unexpected-token"],
    [`sh(wpkh(${KEY_A})`, "unexpected-token"],
    [`wsh(pk(${KEY_A})`, "unexpected-token"],
    [`combo(notakey)`, "invalid-key-expression"],
    [`combo(${KEY_A}`, "unexpected-token"],
  ])("rejects %s with reason %s", (descriptor, reason) => {
    expectParseFailure(descriptor, reason);
  });
});

describe("weights.ts: compactSizeBytes and pushDataPrefixBytes boundaries", () => {
  it("covers every CompactSize boundary", () => {
    expect(compactSizeBytes(0)).toBe(1);
    expect(compactSizeBytes(252)).toBe(1);
    expect(compactSizeBytes(253)).toBe(3);
    expect(compactSizeBytes(0xffff)).toBe(3);
    expect(compactSizeBytes(0x1_0000)).toBe(5);
    expect(compactSizeBytes(0xffff_ffff)).toBe(5);
    expect(compactSizeBytes(0x1_0000_0000)).toBe(9);
  });

  it("covers every pushdata prefix boundary", () => {
    expect(pushDataPrefixBytes(0x4b)).toBe(1);
    expect(pushDataPrefixBytes(0x4c)).toBe(2);
    expect(pushDataPrefixBytes(0xff)).toBe(2);
    expect(pushDataPrefixBytes(0x100)).toBe(3);
    expect(pushDataPrefixBytes(0xffff)).toBe(3);
    expect(pushDataPrefixBytes(0x1_0000)).toBe(5);
  });
});

describe("weights.ts: segwit witness bytes per leaf kind", () => {
  function parseOk(descriptor: string): ScriptNode {
    const result = parseDescriptor(descriptor);

    if (!result.ok) {
      throw new Error(`expected ${descriptor} to parse: ${result.message}`);
    }

    return result.descriptor.script;
  }

  it("computes wsh(pk(...)) and wsh(pkh(...)) input weight", () => {
    expect(inputWeight(parseOk(`wsh(pk(${KEY_A}))`))).toMatchObject({ ok: true });
    expect(inputWeight(parseOk(`wsh(pkh(${KEY_A}))`))).toMatchObject({ ok: true });
  });

  it("computes sh(pk(...)), sh(pkh(...)) and sh(multi(...)) input weight", () => {
    expect(inputWeight(parseOk(`sh(pk(${KEY_A}))`))).toMatchObject({ ok: true });
    expect(inputWeight(parseOk(`sh(pkh(${KEY_A}))`))).toMatchObject({ ok: true });
    expect(inputWeight(parseOk(`sh(multi(1,${KEY_A},${KEY_B}))`))).toMatchObject({ ok: true });
  });

  it("uses a large pushdata prefix for a 15-key P2SH multisig redeem script", () => {
    const keys = Array.from({ length: 15 }, () => KEY_A).join(",");

    expect(inputWeight(parseOk(`sh(multi(1,${keys}))`))).toMatchObject({ ok: true });
  });

  it("gives uncompressed and x-only output keys their own scriptPubKey byte counts", () => {
    expect(outputWeight(parseOk(`pkh(${UNCOMPRESSED_KEY})`))).toMatchObject({ ok: true });
    expect(outputWeight(parseOk(`pk(${UNCOMPRESSED_KEY})`))).toMatchObject({ ok: true });
    expect(outputWeight(parseOk(`pk(${UNCOMPRESSED_WIF})`))).toMatchObject({ ok: true });

    const xonlyPk: ScriptNode = {
      kind: "pk",
      key: { raw: XONLY_A, kind: "hex-xonly", path: [], isRanged: false },
    };

    expect(outputWeight(xonlyPk)).toMatchObject({ ok: true });
  });

  it("computes weight for a multi-leaf tapscript tree", () => {
    const script = parseOk(`tr(${XONLY_A},{pk(${XONLY_A}),pk(${XONLY_A})})`);

    expect(inputWeight(script)).toMatchObject({ ok: true });
  });

  it("rejects addr() output weight for a base58 address whose version matches neither pubkey-hash nor script-hash", () => {
    const script = parseOk("addr(mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn)");

    expect(outputWeight(script)).toMatchObject({ ok: false, reason: "unsupported" });
  });
});

describe("weights.ts: hand-built nodes bypassing the parser's grammar guarantees", () => {
  it("rejects sh(wsh(unsupported)) built directly", () => {
    const node: ScriptNode = {
      kind: "sh",
      inner: {
        kind: "wsh",
        inner: {
          kind: "wpkh",
          key: { raw: KEY_A, kind: "hex-compressed", path: [], isRanged: false },
        },
      },
    };

    expect(inputWeight(node)).toMatchObject({ ok: false, reason: "unsupported" });
  });

  it("rejects sh(unsupported) built directly", () => {
    const node: ScriptNode = {
      kind: "sh",
      inner: {
        kind: "tr",
        internalKey: { raw: XONLY_A, kind: "hex-xonly", path: [], isRanged: false },
      },
    };

    expect(inputWeight(node)).toMatchObject({ ok: false, reason: "unsupported" });
  });

  it("rejects wsh(unsupported) built directly", () => {
    const node: ScriptNode = {
      kind: "wsh",
      inner: {
        kind: "wpkh",
        key: { raw: KEY_A, kind: "hex-compressed", path: [], isRanged: false },
      },
    };

    expect(inputWeight(node)).toMatchObject({ ok: false, reason: "unsupported" });
  });

  it("rejects a raw() node with malformed hex built directly", () => {
    const node: ScriptNode = { kind: "raw", hex: "abc" };

    expect(outputWeight(node)).toMatchObject({ ok: false, reason: "unsupported" });

    const nonHex: ScriptNode = { kind: "raw", hex: "zz" };

    expect(outputWeight(nonHex)).toMatchObject({ ok: false, reason: "unsupported" });
  });
});
