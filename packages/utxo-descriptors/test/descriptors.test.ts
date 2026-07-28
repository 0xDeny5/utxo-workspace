import { describe, expect, it } from "vitest";

import { checksumCreate, checksumVerify, hasValidCharset } from "../src/checksum";
import { expandMultipath } from "../src/multipath";
import { parseDescriptor } from "../src/parse";
import type { ScriptNode } from "../src/types";
import { describeInput, describeOutput, inputWeight, outputWeight } from "../src/weights";

const KEY_A = "02cb674fe0ea2e1e8f79a4e518b8b8ecdff7869f93998fd985637e1317e856da07";
const KEY_B = "03ec2566e4d0b33ed59d5b0ee8c4d0628a776d9d380ac877cfef116d7b6b54c867";
const KEY_C = "024cfa088a9723691a28758550648d756aebe1bbd9a4c3d771bc353541ae762a66";
const XONLY_A = "63cc121461f39de77043ee0583d261de1381f75dd10ac1fc6a95b8ff20994729";
const XPUB =
  "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8";

function parseOk(descriptor: string): ScriptNode {
  const result = parseDescriptor(descriptor);

  if (!result.ok) {
    throw new Error(`expected ${descriptor} to parse, got ${result.reason}: ${result.message}`);
  }

  return result.descriptor.script;
}

describe("checksum", () => {
  it("round-trips a created checksum through verification", () => {
    const script = `pk(${KEY_A})`;
    const checksum = checksumCreate(script);

    expect(checksum).toBeDefined();
    expect(checksum).toHaveLength(8);
    expect(checksumVerify(script, checksum ?? "")).toBe(true);
  });

  it("rejects a tampered checksum", () => {
    const script = `pk(${KEY_A})`;
    const checksum = checksumCreate(script);
    const tampered = checksum === undefined ? "" : `x${checksum.slice(1)}`;

    expect(checksumVerify(script, tampered)).toBe(false);
  });

  it("rejects checksums of the wrong length", () => {
    expect(checksumVerify("pk(...)", "short")).toBe(false);
  });

  it("returns undefined for out-of-charset input", () => {
    expect(checksumCreate("pk(☃)")).toBeUndefined();
    expect(checksumVerify("pk(☃)", "aaaaaaaa")).toBe(false);
  });

  it("rejects a checksum string containing a character outside the checksum alphabet", () => {
    expect(checksumVerify("pk(...)", "aaaaaaa!")).toBe(false);
  });

  it("validates individual characters against the descriptor charset", () => {
    expect(hasValidCharset("(")).toBe(true);
    expect(hasValidCharset("☃")).toBe(false);
  });
});

describe("parseDescriptor: script expressions", () => {
  it("parses pk, pkh and wpkh", () => {
    expect(parseOk(`pk(${KEY_A})`)).toMatchObject({ kind: "pk" });
    expect(parseOk(`pkh(${KEY_A})`)).toMatchObject({ kind: "pkh" });
    expect(parseOk(`wpkh(${KEY_A})`)).toMatchObject({ kind: "wpkh" });
  });

  it("parses sh(), wsh() and their P2SH-P2WSH composition", () => {
    expect(parseOk(`sh(pk(${KEY_A}))`)).toMatchObject({ kind: "sh", inner: { kind: "pk" } });
    expect(parseOk(`sh(wpkh(${KEY_A}))`)).toMatchObject({ kind: "sh", inner: { kind: "wpkh" } });
    expect(parseOk(`wsh(pk(${KEY_A}))`)).toMatchObject({ kind: "wsh", inner: { kind: "pk" } });
    expect(parseOk(`sh(wsh(pk(${KEY_A})))`)).toMatchObject({
      kind: "sh",
      inner: { kind: "wsh", inner: { kind: "pk" } },
    });
  });

  it("parses multi() and sortedmulti() at top level and nested", () => {
    const node = parseOk(`multi(1,${KEY_A},${KEY_B})`);

    expect(node).toMatchObject({ kind: "multi", threshold: 1, sorted: false });
    expect(parseOk(`sortedmulti(2,${KEY_A},${KEY_B},${KEY_C})`)).toMatchObject({
      kind: "multi",
      threshold: 2,
      sorted: true,
    });
    expect(parseOk(`wsh(multi(1,${KEY_A},${KEY_B}))`)).toMatchObject({
      kind: "wsh",
      inner: { kind: "multi" },
    });
  });

  it("parses combo(), raw() and addr()", () => {
    expect(parseOk(`combo(${KEY_A})`)).toMatchObject({ kind: "combo" });
    expect(parseOk("raw(deadbeef)")).toMatchObject({ kind: "raw", hex: "deadbeef" });
    expect(parseOk("raw(DEADBEEF)")).toMatchObject({ kind: "raw", hex: "deadbeef" });
    expect(parseOk("addr(bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4)")).toMatchObject({
      kind: "addr",
      address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
    });
  });

  it("parses tr() with a key path, a single leaf and a tapscript tree", () => {
    const keyPathOnly = parseOk(`tr(${XONLY_A})`);

    expect(keyPathOnly).toMatchObject({ kind: "tr" });
    expect("tree" in keyPathOnly).toBe(false);
    expect(parseOk(`tr(${XONLY_A},pk(${XONLY_A}))`)).toMatchObject({
      kind: "tr",
      tree: { kind: "leaf", script: { kind: "pk" } },
    });
    expect(parseOk(`tr(${XONLY_A},{pk(${XONLY_A}),pk(${XONLY_A})})`)).toMatchObject({
      kind: "tr",
      tree: { kind: "branch" },
    });
  });

  it("parses key origins and derivation paths", () => {
    const node = parseOk(`pkh([d34db33f/44h/0h/0h]${KEY_A})`);

    expect(node).toMatchObject({
      kind: "pkh",
      key: {
        origin: {
          fingerprint: "d34db33f",
          path: [
            { index: 44, hardened: true },
            { index: 0, hardened: true },
            { index: 0, hardened: true },
          ],
        },
      },
    });
    const ranged = parseOk(`wpkh(${XPUB}/0/*)`);

    expect(ranged).toMatchObject({ kind: "wpkh", key: { isRanged: true } });
  });

  it("computes isRanged and checksum on the parsed descriptor", () => {
    const result = parseDescriptor(`wpkh(${XPUB}/0/*)`);

    expect(result).toMatchObject({ ok: true, descriptor: { isRanged: true } });
    const withChecksum = parseDescriptor(`pk(${KEY_A})#${checksumCreate(`pk(${KEY_A})`) ?? ""}`);

    expect(withChecksum).toMatchObject({
      ok: true,
      descriptor: { checksum: checksumCreate(`pk(${KEY_A})`) },
    });
  });
});

describe("parseDescriptor: invalid cases from the BIP test vectors", () => {
  const invalidKeyExpression = { ok: false, reason: "invalid-key-expression" };

  it.each([
    [`pkh([d34db33f/44h/0h/*]${KEY_A})`, "range marker inside a key origin"],
    [`pkh([d34db3f/44h]${KEY_A})`, "7-character fingerprint"],
    [`pkh([d34db33f0/44h]${KEY_A})`, "9-character fingerprint"],
    [`pkh([d34db33f/0f]${KEY_A})`, "lowercase 0f hardened marker"],
    [`pkh([d34db33f/-0]${KEY_A})`, "negative index"],
    [`pkh([d34db33f/0H]${KEY_A})`, "uppercase 0H hardened marker"],
    ["wpkh(cQR3sQBt2xrPGa17R8XiKtxTMLTf7Nx9K5xz9ppMuxsyPsSpBnBH/0)", "derivation after a WIF key"],
    [`wpkh(${XPUB}/2147483648)`, "index at 2^31"],
    [`pkh([d34db33f/0h][d34db33f/0h]${KEY_A})`, "two key origin blocks"],
    [
      "wsh(pkh(04678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5f))",
      "uncompressed key inside wsh()",
    ],
    [`pk(${XONLY_A})`, "bare x-only key outside tr()"],
  ])("rejects %s (%s)", (descriptor) => {
    expect(parseDescriptor(descriptor)).toMatchObject(invalidKeyExpression);
  });

  it("rejects sh(sh(...))", () => {
    expect(parseDescriptor(`sh(sh(wpkh(${KEY_A})))`)).toMatchObject({
      ok: false,
      reason: "invalid-context",
    });
  });

  it("rejects wsh(tr(...))", () => {
    expect(parseDescriptor(`wsh(tr(${XONLY_A}))`)).toMatchObject({
      ok: false,
      reason: "invalid-context",
    });
  });

  it("rejects tr(KEY,pkh(...)) since tapscript leaves are pk-only in v1", () => {
    expect(parseDescriptor(`tr(${XONLY_A},pkh(${KEY_A}))`)).toMatchObject({
      ok: false,
      reason: "unsupported",
    });
  });

  it("rejects duplicate multipath values", () => {
    expect(parseDescriptor(`wpkh(${XPUB}/<0;0>/*)`)).toMatchObject({
      ok: false,
      reason: "invalid-key-expression",
    });
  });

  it("rejects an invalid checksum", () => {
    const good = checksumCreate(`pk(${KEY_A})`) ?? "";
    const bad = `x${good.slice(1)}`;

    expect(parseDescriptor(`pk(${KEY_A})#${bad}`)).toMatchObject({
      ok: false,
      reason: "invalid-checksum",
    });
  });

  it("rejects a checksum of the wrong length", () => {
    expect(parseDescriptor(`pk(${KEY_A})#short`)).toMatchObject({
      ok: false,
      reason: "invalid-checksum",
    });
  });

  it("rejects an out-of-charset character", () => {
    expect(parseDescriptor(`pk(${KEY_A} ☃)`)).toMatchObject({
      ok: false,
      reason: "invalid-character",
    });
  });

  it("rejects unknown functions and reserved BIP-390/392 names", () => {
    expect(parseDescriptor(`notafunction(${KEY_A})`)).toMatchObject({
      ok: false,
      reason: "unknown-function",
    });
    expect(parseDescriptor(`musig(${KEY_A},${KEY_B})`)).toMatchObject({
      ok: false,
      reason: "unsupported",
    });
    expect(parseDescriptor(`sp(${KEY_A},${KEY_B})`)).toMatchObject({
      ok: false,
      reason: "unsupported",
    });
  });

  it("rejects sh()/combo()/raw()/addr()/tr() outside the top level", () => {
    expect(parseDescriptor(`wsh(sh(pk(${KEY_A})))`)).toMatchObject({
      ok: false,
      reason: "invalid-context",
    });
    expect(parseDescriptor(`sh(combo(${KEY_A}))`)).toMatchObject({
      ok: false,
      reason: "invalid-context",
    });
    expect(parseDescriptor("sh(raw(deadbeef))")).toMatchObject({
      ok: false,
      reason: "invalid-context",
    });
    expect(parseDescriptor("sh(addr(bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4))")).toMatchObject({
      ok: false,
      reason: "invalid-context",
    });
    expect(parseDescriptor(`sh(tr(${XONLY_A}))`)).toMatchObject({
      ok: false,
      reason: "invalid-context",
    });
  });

  it("rejects wpkh() nested inside wsh()", () => {
    expect(parseDescriptor(`wsh(wpkh(${KEY_A}))`)).toMatchObject({
      ok: false,
      reason: "invalid-context",
    });
  });

  it("rejects wsh() nested inside wsh()", () => {
    expect(parseDescriptor(`wsh(wsh(pk(${KEY_A})))`)).toMatchObject({
      ok: false,
      reason: "invalid-context",
    });
  });

  it("rejects a multi() threshold outside 1..n", () => {
    expect(parseDescriptor(`multi(0,${KEY_A})`)).toMatchObject({
      ok: false,
      reason: "invalid-context",
    });
    expect(parseDescriptor(`multi(2,${KEY_A})`)).toMatchObject({
      ok: false,
      reason: "invalid-context",
    });
  });

  it("rejects a multi() key count above the per-context limit", () => {
    const keys = Array.from({ length: 4 }, () => KEY_A).join(",");

    expect(parseDescriptor(`multi(1,${keys})`)).toMatchObject({
      ok: false,
      reason: "key-count-exceeded",
    });
  });

  it("rejects malformed raw() hex", () => {
    expect(parseDescriptor("raw(zz)")).toMatchObject({ ok: false, reason: "invalid-context" });
    expect(parseDescriptor("raw(abc)")).toMatchObject({ ok: false, reason: "invalid-context" });
  });

  it("rejects unterminated or malformed key origins", () => {
    expect(parseDescriptor(`pkh([d34db33f${KEY_A})`)).toMatchObject({
      ok: false,
      reason: "invalid-key-expression",
    });
    expect(parseDescriptor(`pkh([]${KEY_A})`)).toMatchObject({
      ok: false,
      reason: "invalid-key-expression",
    });
    expect(parseDescriptor("pkh([d34db33f]")).toMatchObject({
      ok: false,
      reason: "invalid-key-expression",
    });
  });

  it("rejects unrecognized key material", () => {
    expect(parseDescriptor("pk(not-a-key)")).toMatchObject({
      ok: false,
      reason: "invalid-key-expression",
    });
  });

  it("rejects trailing content after a complete descriptor", () => {
    expect(parseDescriptor(`pk(${KEY_A})garbage`)).toMatchObject({
      ok: false,
      reason: "unexpected-token",
    });
  });

  it("rejects an empty descriptor and unterminated expressions", () => {
    expect(parseDescriptor("")).toMatchObject({ ok: false, reason: "unexpected-token" });
    expect(parseDescriptor("pk(")).toMatchObject({ ok: false, reason: "unexpected-token" });
    expect(parseDescriptor(`pk(${KEY_A}`)).toMatchObject({ ok: false, reason: "unexpected-token" });
  });

  it("rejects a multipath tuple with a single value", () => {
    expect(parseDescriptor(`wpkh(${XPUB}/<0>/*)`)).toMatchObject({
      ok: false,
      reason: "invalid-key-expression",
    });
  });
});

describe("expandMultipath", () => {
  it("returns the original descriptor unchanged when there is no multipath element", () => {
    const script = parseOk(`wpkh(${KEY_A})`);
    const result = expandMultipath(script);

    expect(result).toMatchObject({ ok: true, descriptors: [script] });
  });

  it("expands a multipath element into one descriptor per tuple position", () => {
    const script = parseOk(`wpkh(${XPUB}/<0;1>/*)`);
    const result = expandMultipath(script);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.descriptors).toHaveLength(2);
    expect(result.descriptors[0]).toMatchObject({
      key: { path: [{ kind: "step", index: 0, hardened: false }] },
    });
    expect(result.descriptors[1]).toMatchObject({
      key: { path: [{ kind: "step", index: 1, hardened: false }] },
    });
  });

  it("allows hardened and unordered multipath tuple elements", () => {
    const script = parseOk(`wpkh(${XPUB}/<1h;0>/*)`);
    const result = expandMultipath(script);

    expect(result).toMatchObject({
      ok: true,
      descriptors: [
        { key: { path: [{ index: 1, hardened: true }] } },
        { key: { path: [{ index: 0, hardened: false }] } },
      ],
    });
  });

  it("expands multipath keys nested inside sh/wsh/multi/tr", () => {
    const shScript = parseOk(`sh(wpkh(${XPUB}/<0;1>/*))`);

    expect(expandMultipath(shScript)).toMatchObject({ ok: true, descriptors: [{}, {}] });
    const multiScript = parseOk(`wsh(multi(1,${XPUB}/<0;1>/*,${KEY_A}))`);

    expect(expandMultipath(multiScript)).toMatchObject({ ok: true, descriptors: [{}, {}] });
    const trScript = parseOk(`tr(${XONLY_A},pk(${XONLY_A}))`);

    expect(expandMultipath(trScript)).toMatchObject({ ok: true, descriptors: [trScript] });
  });

  it("expands multipath keys in pk(), pkh() and combo()", () => {
    const pkScript = parseOk(`pk(${XPUB}/<0;1>/*)`);

    expect(expandMultipath(pkScript)).toMatchObject({ ok: true, descriptors: [{}, {}] });
    const pkhScript = parseOk(`pkh(${XPUB}/<0;1>/*)`);

    expect(expandMultipath(pkhScript)).toMatchObject({ ok: true, descriptors: [{}, {}] });
    const comboScript = parseOk(`combo(${XPUB}/<0;1>/*)`);

    expect(expandMultipath(comboScript)).toMatchObject({ ok: true, descriptors: [{}, {}] });
  });

  it("expands a multipath internal key in tr() with no script tree", () => {
    const script = parseOk(`tr(${XPUB}/<0;1>/*)`);
    const result = expandMultipath(script);

    expect(result).toMatchObject({ ok: true, descriptors: [{}, {}] });
  });

  it("expands a multipath internal key across a multi-leaf tapscript tree", () => {
    const script = parseOk(`tr(${XPUB}/<0;1>/*,{pk(${XONLY_A}),pk(${XONLY_A})})`);
    const result = expandMultipath(script);

    expect(result).toMatchObject({
      ok: true,
      descriptors: [
        { internalKey: { path: [{ index: 0, hardened: false }] } },
        { internalKey: { path: [{ index: 1, hardened: false }] } },
      ],
    });
  });

  it("leaves path elements before and after the multipath marker unchanged", () => {
    const script = parseOk(`wpkh(${XPUB}/44h/<0;1>/*)`);
    const result = expandMultipath(script);

    expect(result).toMatchObject({
      ok: true,
      descriptors: [
        { key: { path: [{ kind: "step", index: 44, hardened: true }, { index: 0 }] } },
        { key: { path: [{ kind: "step", index: 44, hardened: true }, { index: 1 }] } },
      ],
    });
  });

  it("fails when two multipath elements disagree on tuple length", () => {
    const first = parseOk(`wpkh(${XPUB}/<0;1>/*)`);
    const second = parseOk(`wpkh(${XPUB}/<0;1;2>/*)`);

    if (first.kind !== "wpkh" || second.kind !== "wpkh") {
      throw new Error("expected wpkh nodes");
    }

    const combined: ScriptNode = {
      kind: "multi",
      threshold: 1,
      sorted: false,
      keys: [first.key, second.key],
    };
    const combinedResult = expandMultipath(combined);

    expect(combinedResult.ok).toBe(false);

    if (!combinedResult.ok) {
      expect(combinedResult.message).toContain("same number of values");
    }
  });
});

describe("inputWeight and outputWeight", () => {
  it("agrees with utxo-coinselect's known-good catalog values for basic script types", () => {
    expect(inputWeight(parseOk(`pk(${KEY_A})`))).toEqual({ ok: true, weight: 456 });
    expect(inputWeight(parseOk(`pkh(${KEY_A})`))).toEqual({ ok: true, weight: 592 });
    expect(inputWeight(parseOk(`wpkh(${KEY_A})`))).toEqual({ ok: true, weight: 272 });
    expect(inputWeight(parseOk(`sh(wpkh(${KEY_A}))`))).toEqual({ ok: true, weight: 364 });
    expect(inputWeight(parseOk(`tr(${XONLY_A})`))).toEqual({ ok: true, weight: 230 });
    expect(inputWeight(parseOk(`wsh(multi(2,${KEY_A},${KEY_B},${KEY_C}))`))).toEqual({
      ok: true,
      weight: 420,
    });

    expect(outputWeight(parseOk(`pk(${KEY_A})`))).toEqual({ ok: true, weight: 176 });
    expect(outputWeight(parseOk(`pkh(${KEY_A})`))).toEqual({ ok: true, weight: 136 });
    expect(outputWeight(parseOk(`wpkh(${KEY_A})`))).toEqual({ ok: true, weight: 124 });
    expect(outputWeight(parseOk(`sh(wpkh(${KEY_A}))`))).toEqual({ ok: true, weight: 128 });
    expect(outputWeight(parseOk(`wsh(pk(${KEY_A}))`))).toEqual({ ok: true, weight: 172 });
    expect(outputWeight(parseOk(`tr(${XONLY_A})`))).toEqual({ ok: true, weight: 172 });
  });

  it("fails inputWeight for addr(), raw() and combo() with the documented reasons", () => {
    expect(inputWeight(parseOk("addr(bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4)"))).toMatchObject({
      ok: false,
      reason: "opaque-script",
    });
    expect(inputWeight(parseOk("raw(deadbeef)"))).toMatchObject({
      ok: false,
      reason: "opaque-script",
    });
    expect(inputWeight(parseOk(`combo(${KEY_A})`))).toMatchObject({
      ok: false,
      reason: "ambiguous-script-type",
    });
  });

  it("succeeds outputWeight for addr() and raw() but fails for combo()", () => {
    expect(outputWeight(parseOk("addr(bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4)"))).toMatchObject(
      {
        ok: true,
      },
    );
    expect(outputWeight(parseOk("raw(deadbeef)"))).toEqual({ ok: true, weight: 52 });
    expect(outputWeight(parseOk(`combo(${KEY_A})`))).toMatchObject({
      ok: false,
      reason: "ambiguous-script-type",
    });
  });

  it("resolves addr() output weight for legacy base58 addresses on both mainnet and testnet", () => {
    expect(outputWeight(parseOk("addr(1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2)"))).toEqual({
      ok: true,
      weight: 136,
    });
    expect(outputWeight(parseOk("addr(3P14159f73E4gFr7JterCCQh9QjiTjiZrG)"))).toEqual({
      ok: true,
      weight: 128,
    });
  });

  it("fails addr() output weight for an unrecognized address", () => {
    expect(outputWeight(parseOk("addr(not-an-address)"))).toMatchObject({
      ok: false,
      reason: "unsupported",
    });
  });

  it("increases multisig weight monotonically with the key count", () => {
    const two = inputWeight(parseOk(`wsh(multi(1,${KEY_A},${KEY_B}))`));
    const three = inputWeight(parseOk(`wsh(multi(1,${KEY_A},${KEY_B},${KEY_C}))`));

    expect(two.ok && three.ok && three.weight > two.weight).toBe(true);
  });

  it("gives a tapscript leaf a witness at least as large as the key path", () => {
    const keyPath = inputWeight(parseOk(`tr(${XONLY_A})`));
    const scriptPath = inputWeight(parseOk(`tr(${XONLY_A},pk(${XONLY_A}))`));

    expect(keyPath.ok && scriptPath.ok && scriptPath.weight >= keyPath.weight).toBe(true);
  });
});

describe("describeInput and describeOutput", () => {
  it("maps simple script kinds to the utxo-coinselect string catalog", () => {
    expect(describeInput(parseOk(`pk(${KEY_A})`))).toEqual({ ok: true, description: "p2pk" });
    expect(describeInput(parseOk(`pkh(${KEY_A})`))).toEqual({ ok: true, description: "p2pkh" });
    expect(describeInput(parseOk(`wpkh(${KEY_A})`))).toEqual({ ok: true, description: "p2wpkh" });
    expect(describeInput(parseOk(`sh(wpkh(${KEY_A}))`))).toEqual({
      ok: true,
      description: "p2sh-p2wpkh",
    });
    expect(describeInput(parseOk(`tr(${XONLY_A})`))).toEqual({ ok: true, description: "p2tr" });
  });

  it("maps multisig nesting to the structured multisig descriptions", () => {
    expect(describeInput(parseOk(`sh(multi(1,${KEY_A},${KEY_B}))`))).toEqual({
      ok: true,
      description: { type: "p2sh-multisig", m: 1, n: 2 },
    });
    expect(describeInput(parseOk(`wsh(multi(1,${KEY_A},${KEY_B}))`))).toEqual({
      ok: true,
      description: { type: "p2wsh-multisig", m: 1, n: 2 },
    });
    expect(describeInput(parseOk(`sh(wsh(multi(1,${KEY_A},${KEY_B})))`))).toEqual({
      ok: true,
      description: { type: "p2sh-p2wsh-multisig", m: 1, n: 2 },
    });
  });

  it("falls back to a raw description for a tapscript leaf spend", () => {
    const result = describeInput(parseOk(`tr(${XONLY_A},pk(${XONLY_A}))`));

    expect(result).toMatchObject({ ok: true, description: { type: "raw" } });
  });

  it("fails describeInput for addr(), raw() and combo()", () => {
    expect(
      describeInput(parseOk("addr(bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4)")),
    ).toMatchObject({
      ok: false,
      reason: "opaque-script",
    });
    expect(describeInput(parseOk("raw(deadbeef)"))).toMatchObject({
      ok: false,
      reason: "opaque-script",
    });
    expect(describeInput(parseOk(`combo(${KEY_A})`))).toMatchObject({
      ok: false,
      reason: "ambiguous-script-type",
    });
  });

  it("maps output script kinds, including the raw fallback for multi/raw/addr", () => {
    expect(describeOutput(parseOk(`pk(${KEY_A})`))).toEqual({ ok: true, description: "p2pk" });
    expect(describeOutput(parseOk(`pkh(${KEY_A})`))).toEqual({ ok: true, description: "p2pkh" });
    expect(describeOutput(parseOk(`wpkh(${KEY_A})`))).toEqual({ ok: true, description: "p2wpkh" });
    expect(describeOutput(parseOk(`sh(wpkh(${KEY_A}))`))).toEqual({
      ok: true,
      description: "p2sh",
    });
    expect(describeOutput(parseOk(`wsh(pk(${KEY_A}))`))).toEqual({
      ok: true,
      description: "p2wsh",
    });
    expect(describeOutput(parseOk(`tr(${XONLY_A})`))).toEqual({ ok: true, description: "p2tr" });
    expect(describeOutput(parseOk(`multi(1,${KEY_A},${KEY_B})`))).toMatchObject({
      ok: true,
      description: { type: "raw" },
    });
    expect(describeOutput(parseOk("raw(deadbeef)"))).toEqual({
      ok: true,
      description: { type: "raw", scriptPubKeyBytes: 4 },
    });
    expect(
      describeOutput(parseOk("addr(bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4)")),
    ).toMatchObject({ ok: true, description: { type: "raw" } });
  });

  it("fails describeOutput for combo()", () => {
    expect(describeOutput(parseOk(`combo(${KEY_A})`))).toMatchObject({
      ok: false,
      reason: "ambiguous-script-type",
    });
  });
});
