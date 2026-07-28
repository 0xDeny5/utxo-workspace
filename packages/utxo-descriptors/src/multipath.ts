import { forEachKey } from "./traverse";
import type { KeyExpression, ScriptNode, TapLeafScript, TapTree } from "./types";

export interface MultipathFailure {
  readonly ok: false;
  readonly message: string;
}

export interface MultipathSuccess {
  readonly ok: true;
  /** One descriptor per BIP-389 tuple position; length 1 when no multipath is present. */
  readonly descriptors: readonly ScriptNode[];
}

export type MultipathResult = MultipathSuccess | MultipathFailure;

/**
 * `raw()` and `addr()` carry no keys and, per the grammar enforced in
 * `parse.ts`, can only ever appear as an entire top-level descriptor, never
 * nested under `sh()`/`wsh()`/`tr()`. `expandMultipath` only calls
 * `mapKeys()` once it has already found a multipath key somewhere in the
 * tree, which a keyless `raw()`/`addr()` descriptor can never do, so this
 * narrower type documents (and enforces) that invariant instead of a dead
 * switch case that could never run.
 */
type KeyedScriptNode = Exclude<ScriptNode, { readonly kind: "raw" | "addr" }>;

function mapKeys(
  node: KeyedScriptNode,
  fn: (key: KeyExpression) => KeyExpression,
): KeyedScriptNode {
  switch (node.kind) {
    case "pk":
    case "pkh":
    case "wpkh":
    case "combo":
      return { ...node, key: fn(node.key) };
    case "sh":
    case "wsh":
      return { ...node, inner: mapKeys(node.inner as KeyedScriptNode, fn) };
    case "multi":
      return { ...node, keys: node.keys.map(fn) };
    case "tr":
      return {
        ...node,
        internalKey: fn(node.internalKey),
        ...(node.tree !== undefined ? { tree: mapTapTree(node.tree, fn) } : {}),
      };
  }
}

function mapTapTree(tree: TapTree, fn: (key: KeyExpression) => KeyExpression): TapTree {
  if (tree.kind === "leaf") {
    const leaf: TapLeafScript = { kind: "pk", key: fn(tree.script.key) };

    return { kind: "leaf", script: leaf };
  }

  return { kind: "branch", left: mapTapTree(tree.left, fn), right: mapTapTree(tree.right, fn) };
}

function replaceMultipathAt(key: KeyExpression, index: number): KeyExpression {
  const elementIndex = key.path.findIndex((element) => element.kind === "multipath");

  if (elementIndex === -1) {
    return key;
  }

  const path = key.path.map((element, position) => {
    if (position !== elementIndex || element.kind !== "multipath") {
      return element;
    }

    // Safe by construction: expandMultipath only calls this for indices
    // within every multipath element's validated, equal tuple length.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const value = element.values[index]!;

    return { kind: "step" as const, ...value };
  });

  return { ...key, path };
}

/**
 * Expands BIP-389 multipath key expressions (e.g. `<0;1>`) into one
 * descriptor per tuple position. Every multipath element in a descriptor
 * must share the same tuple length; duplicate values within one tuple are
 * rejected during parsing, not here.
 */
export function expandMultipath(script: ScriptNode): MultipathResult {
  const lengths = new Set<number>();

  forEachKey(script, (key) => {
    for (const element of key.path) {
      if (element.kind === "multipath") {
        lengths.add(element.values.length);
      }
    }
  });

  if (lengths.size === 0) {
    return { ok: true, descriptors: [script] };
  }

  if (lengths.size > 1) {
    return {
      ok: false,
      message: "every multipath element in a descriptor must have the same number of values",
    };
  }

  // Safe by construction: lengths.size === 1 was just checked above.
  const [length] = [...lengths] as [number];
  const descriptors: ScriptNode[] = [];

  for (let index = 0; index < length; index += 1) {
    descriptors.push(mapKeys(script as KeyedScriptNode, (key) => replaceMultipathAt(key, index)));
  }

  return { ok: true, descriptors };
}
