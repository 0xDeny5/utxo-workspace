import type { KeyExpression, ScriptNode, TapTree } from "./types";

export function forEachKey(node: ScriptNode, visit: (key: KeyExpression) => void): void {
  switch (node.kind) {
    case "pk":
    case "pkh":
    case "wpkh":
    case "combo":
      visit(node.key);

      break;
    case "sh":
    case "wsh":
      forEachKey(node.inner, visit);

      break;
    case "multi":
      node.keys.forEach(visit);

      break;
    case "raw":
    case "addr":
      break;
    case "tr":
      visit(node.internalKey);

      if (node.tree !== undefined) {
        forEachKeyInTree(node.tree, visit);
      }

      break;
  }
}

function forEachKeyInTree(tree: TapTree, visit: (key: KeyExpression) => void): void {
  if (tree.kind === "leaf") {
    visit(tree.script.key);

    return;
  }

  forEachKeyInTree(tree.left, visit);
  forEachKeyInTree(tree.right, visit);
}

export function anyKeyRanged(node: ScriptNode): boolean {
  let ranged = false;

  forEachKey(node, (key) => {
    if (key.isRanged) {
      ranged = true;
    }
  });

  return ranged;
}

export interface TapLeafWithDepth {
  readonly key: KeyExpression;
  readonly depth: number;
}

/** Depth is the number of sibling hashes needed in the control block. */
export function collectTapLeaves(tree: TapTree, depth = 0): TapLeafWithDepth[] {
  if (tree.kind === "leaf") {
    return [{ key: tree.script.key, depth }];
  }

  return [...collectTapLeaves(tree.left, depth + 1), ...collectTapLeaves(tree.right, depth + 1)];
}
