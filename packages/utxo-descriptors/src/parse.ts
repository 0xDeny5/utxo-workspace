import { checksumVerify } from "./checksum";
import { parseKeyExpression } from "./key-expression";
import type { Token, TokenKind } from "./tokenizer";
import { tokenize } from "./tokenizer";
import { anyKeyRanged } from "./traverse";
import type {
  KeyExpression,
  ParsedDescriptor,
  ParseFailure,
  ParseFailureReason,
  ParseResult,
  ScriptNode,
  TapLeafScript,
  TapTree,
} from "./types";

const CHECKSUM_LENGTH = 8;
const HEX_PAIR = 2;

type Context = { readonly place: "top" } | { readonly place: "sh" } | { readonly place: "wsh" };

function keyLimit(context: Context): number {
  if (context.place === "top") {
    return 3;
  }

  if (context.place === "sh") {
    return 15;
  }

  return 20;
}

function requireCompressed(context: Context): boolean {
  return context.place === "wsh";
}

function isCompressedCapable(key: KeyExpression): boolean {
  return (
    key.kind === "hex-compressed" ||
    key.kind === "wif-compressed" ||
    key.kind === "xpub" ||
    key.kind === "xprv"
  );
}

class Cursor {
  private position = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  peek(): Token | undefined {
    return this.tokens[this.position];
  }

  advance(): Token | undefined {
    const token = this.tokens[this.position];

    this.position += 1;

    return token;
  }

  atEnd(): boolean {
    return this.position >= this.tokens.length;
  }
}

function fail(reason: ParseFailureReason, message: string, position?: number): ParseFailure {
  return { ok: false, reason, message, ...(position !== undefined ? { position } : {}) };
}

type NodeResult = { readonly ok: true; readonly node: ScriptNode } | ParseFailure;
type KeyResult = { readonly ok: true; readonly key: KeyExpression } | ParseFailure;
type TreeResult = { readonly ok: true; readonly tree: TapTree } | ParseFailure;

type TokenResult = { readonly ok: true; readonly token: Token } | ParseFailure;

function expectKind(cursor: Cursor, kind: TokenKind, what: string): TokenResult {
  const token = cursor.advance();

  if (token === undefined) {
    return fail("unexpected-token", `expected ${what} but reached the end of the descriptor`);
  }

  if (token.kind !== kind) {
    return fail("unexpected-token", `expected ${what}`, token.position);
  }

  return { ok: true, token };
}

function isFailure(value: { readonly ok: boolean }): value is ParseFailure {
  return !value.ok;
}

function parseKey(cursor: Cursor, allowXOnly: boolean): KeyResult {
  const token = cursor.advance();

  if (token === undefined) {
    return fail(
      "unexpected-token",
      "expected a key expression but reached the end of the descriptor",
    );
  }

  if (token.kind !== "atom") {
    return fail("unexpected-token", "expected a key expression", token.position);
  }

  const result = parseKeyExpression(token.text, { allowXOnly });

  if (!result.ok) {
    return fail("invalid-key-expression", result.message, token.position);
  }

  return { ok: true, key: result.key };
}

function parseNumber(cursor: Cursor): { readonly ok: true; readonly value: number } | ParseFailure {
  const token = cursor.advance();

  if (token === undefined) {
    return fail("unexpected-token", "expected a number but reached the end of the descriptor");
  }

  if (
    token.kind !== "atom" ||
    !/^[0-9]+$/.test(token.text) ||
    !Number.isSafeInteger(Number(token.text))
  ) {
    return fail("unexpected-token", "expected a number", token.position);
  }

  return { ok: true, value: Number(token.text) };
}

function parseSingleKeyNode(
  cursor: Cursor,
  kind: "pk" | "pkh" | "wpkh",
  context: Context,
  position: number,
): NodeResult {
  const keyResult = parseKey(cursor, false);

  if (isFailure(keyResult)) {
    return keyResult;
  }

  if ((kind === "wpkh" || requireCompressed(context)) && !isCompressedCapable(keyResult.key)) {
    return fail("invalid-key-expression", `${kind}() requires a compressed key`, position);
  }

  const closeResult = expectKind(cursor, "rparen", `')' to close ${kind}(...)`);

  if (isFailure(closeResult)) {
    return closeResult;
  }

  return { ok: true, node: { kind, key: keyResult.key } };
}

function parseMultiNode(
  cursor: Cursor,
  sorted: boolean,
  context: Context,
  position: number,
): NodeResult {
  const thresholdResult = parseNumber(cursor);

  if (isFailure(thresholdResult)) {
    return thresholdResult;
  }

  const keys: KeyExpression[] = [];

  for (;;) {
    const comma = expectKind(cursor, "comma", "',' before a key in multi(...)");

    if (isFailure(comma)) {
      return comma;
    }

    const keyResult = parseKey(cursor, false);

    if (isFailure(keyResult)) {
      return keyResult;
    }

    if (requireCompressed(context) && !isCompressedCapable(keyResult.key)) {
      return fail("invalid-key-expression", "keys inside wsh() must be compressed", position);
    }

    keys.push(keyResult.key);

    if (cursor.peek()?.kind !== "comma") {
      break;
    }
  }

  const closeResult = expectKind(cursor, "rparen", "')' to close multi(...)");

  if (isFailure(closeResult)) {
    return closeResult;
  }

  const limit = keyLimit(context);

  if (keys.length > limit) {
    return fail(
      "key-count-exceeded",
      `at most ${String(limit)} keys are allowed in this context`,
      position,
    );
  }

  if (thresholdResult.value < 1 || thresholdResult.value > keys.length) {
    return fail("invalid-context", "threshold must be between 1 and the number of keys", position);
  }

  return { ok: true, node: { kind: "multi", threshold: thresholdResult.value, keys, sorted } };
}

function parseTapLeaf(cursor: Cursor): TreeResult {
  const nameToken = cursor.advance();

  if (nameToken === undefined) {
    return fail(
      "unexpected-token",
      "expected a tapscript leaf but reached the end of the descriptor",
    );
  }

  if (nameToken.kind !== "atom" || nameToken.text !== "pk") {
    return fail(
      "unsupported",
      "tapscript leaves are limited to pk(KEY) in this version; other miniscript fragments are not yet supported",
      nameToken.position,
    );
  }

  const lparen = expectKind(cursor, "lparen", "'(' after pk");

  if (isFailure(lparen)) {
    return lparen;
  }

  const keyResult = parseKey(cursor, true);

  if (isFailure(keyResult)) {
    return keyResult;
  }

  const closeResult = expectKind(cursor, "rparen", "')' to close pk(...)");

  if (isFailure(closeResult)) {
    return closeResult;
  }

  const leaf: TapLeafScript = { kind: "pk", key: keyResult.key };

  return { ok: true, tree: { kind: "leaf", script: leaf } };
}

function parseTapTree(cursor: Cursor): TreeResult {
  if (cursor.peek()?.kind === "lbrace") {
    cursor.advance();

    const leftResult = parseTapTree(cursor);

    if (isFailure(leftResult)) {
      return leftResult;
    }

    const comma = expectKind(cursor, "comma", "',' inside a tapscript tree branch");

    if (isFailure(comma)) {
      return comma;
    }

    const rightResult = parseTapTree(cursor);

    if (isFailure(rightResult)) {
      return rightResult;
    }

    const closeResult = expectKind(cursor, "rbrace", "'}' to close a tapscript tree branch");

    if (isFailure(closeResult)) {
      return closeResult;
    }

    return { ok: true, tree: { kind: "branch", left: leftResult.tree, right: rightResult.tree } };
  }

  return parseTapLeaf(cursor);
}

function parseTr(cursor: Cursor): NodeResult {
  const keyResult = parseKey(cursor, true);

  if (isFailure(keyResult)) {
    return keyResult;
  }

  if (cursor.peek()?.kind === "rparen") {
    cursor.advance();

    return { ok: true, node: { kind: "tr", internalKey: keyResult.key } };
  }

  const comma = expectKind(cursor, "comma", "',' before the tapscript tree in tr(...)");

  if (isFailure(comma)) {
    return comma;
  }

  const treeResult = parseTapTree(cursor);

  if (isFailure(treeResult)) {
    return treeResult;
  }

  const closeResult = expectKind(cursor, "rparen", "')' to close tr(...)");

  if (isFailure(closeResult)) {
    return closeResult;
  }

  return { ok: true, node: { kind: "tr", internalKey: keyResult.key, tree: treeResult.tree } };
}

function parseRaw(cursor: Cursor, position: number): NodeResult {
  const token = cursor.advance();

  if (token === undefined) {
    return fail("unexpected-token", "expected hex data in raw(...)", position);
  }

  if (
    token.kind !== "atom" ||
    !/^[0-9a-fA-F]+$/.test(token.text) ||
    token.text.length % HEX_PAIR !== 0
  ) {
    return fail("invalid-context", "raw() requires an even-length hex string", token.position);
  }

  const closeResult = expectKind(cursor, "rparen", "')' to close raw(...)");

  if (isFailure(closeResult)) {
    return closeResult;
  }

  return { ok: true, node: { kind: "raw", hex: token.text.toLowerCase() } };
}

function parseAddr(cursor: Cursor, position: number): NodeResult {
  const token = cursor.advance();

  if (token?.kind !== "atom") {
    return fail("unexpected-token", "expected an address in addr(...)", position);
  }

  const closeResult = expectKind(cursor, "rparen", "')' to close addr(...)");

  if (isFailure(closeResult)) {
    return closeResult;
  }

  return { ok: true, node: { kind: "addr", address: token.text } };
}

function parseScript(cursor: Cursor, context: Context): NodeResult {
  const nameToken = cursor.advance();

  if (nameToken === undefined) {
    return fail(
      "unexpected-token",
      "expected a script expression but reached the end of the descriptor",
    );
  }

  if (nameToken.kind !== "atom") {
    return fail("unexpected-token", "expected a function name", nameToken.position);
  }

  const name = nameToken.text;
  const position = nameToken.position;
  const lparen = expectKind(cursor, "lparen", `'(' after ${name}`);

  if (isFailure(lparen)) {
    return lparen;
  }

  switch (name) {
    case "pk":
    case "pkh":
      return parseSingleKeyNode(cursor, name, context, position);
    case "wpkh": {
      if (context.place === "wsh") {
        return fail("invalid-context", "wpkh() is not allowed inside wsh()", position);
      }

      return parseSingleKeyNode(cursor, "wpkh", context, position);
    }

    case "sh": {
      if (context.place !== "top") {
        return fail("invalid-context", "sh() is only allowed at the top level", position);
      }

      const innerResult = parseScript(cursor, { place: "sh" });

      if (isFailure(innerResult)) {
        return innerResult;
      }

      const closeResult = expectKind(cursor, "rparen", "')' to close sh(...)");

      if (isFailure(closeResult)) {
        return closeResult;
      }

      return { ok: true, node: { kind: "sh", inner: innerResult.node } };
    }

    case "wsh": {
      if (context.place === "wsh") {
        return fail("invalid-context", "wsh() cannot be nested inside wsh()", position);
      }

      const innerResult = parseScript(cursor, { place: "wsh" });

      if (isFailure(innerResult)) {
        return innerResult;
      }

      const closeResult = expectKind(cursor, "rparen", "')' to close wsh(...)");

      if (isFailure(closeResult)) {
        return closeResult;
      }

      return { ok: true, node: { kind: "wsh", inner: innerResult.node } };
    }

    case "multi":
    case "sortedmulti":
      return parseMultiNode(cursor, name === "sortedmulti", context, position);
    case "combo": {
      if (context.place !== "top") {
        return fail("invalid-context", "combo() is only allowed at the top level", position);
      }

      const keyResult = parseKey(cursor, false);

      if (isFailure(keyResult)) {
        return keyResult;
      }

      const closeResult = expectKind(cursor, "rparen", "')' to close combo(...)");

      if (isFailure(closeResult)) {
        return closeResult;
      }

      return { ok: true, node: { kind: "combo", key: keyResult.key } };
    }

    case "raw": {
      if (context.place !== "top") {
        return fail("invalid-context", "raw() is only allowed at the top level", position);
      }

      return parseRaw(cursor, position);
    }

    case "addr": {
      if (context.place !== "top") {
        return fail("invalid-context", "addr() is only allowed at the top level", position);
      }

      return parseAddr(cursor, position);
    }

    case "tr": {
      if (context.place !== "top") {
        return fail("invalid-context", "tr() is only allowed at the top level", position);
      }

      return parseTr(cursor);
    }

    case "musig":
      return fail("unsupported", "musig() (BIP-390) is not implemented", position);
    case "sp":
      return fail("unsupported", "sp() (BIP-392, silent payments) is not implemented", position);
    default:
      return fail("unknown-function", `unknown script expression: ${name}`, position);
  }
}

/**
 * Parses a BIP-380 descriptor string into an AST, without deriving any keys
 * or scriptPubKeys. See the README for exactly which fragments are
 * supported in this version.
 */
export function parseDescriptor(text: string): ParseResult {
  const hashIndex = text.indexOf("#");
  const scriptText = hashIndex === -1 ? text : text.slice(0, hashIndex);
  const tokenizeResult = tokenize(scriptText);

  if (!tokenizeResult.ok) {
    return fail(
      "invalid-character",
      "the descriptor contains a character outside the allowed charset",
      tokenizeResult.position,
    );
  }

  if (hashIndex !== -1) {
    const checksumText = text.slice(hashIndex + 1);

    if (checksumText.length !== CHECKSUM_LENGTH || !checksumVerify(scriptText, checksumText)) {
      return fail("invalid-checksum", "the descriptor checksum does not match its script");
    }
  }

  const cursor = new Cursor(tokenizeResult.tokens);
  const scriptResult = parseScript(cursor, { place: "top" });

  if (isFailure(scriptResult)) {
    return scriptResult;
  }

  if (!cursor.atEnd()) {
    return fail(
      "unexpected-token",
      "unexpected trailing content after the descriptor",
      cursor.peek()?.position,
    );
  }

  const descriptor: ParsedDescriptor = {
    script: scriptResult.node,
    ...(hashIndex !== -1 ? { checksum: text.slice(hashIndex + 1) } : {}),
    isRanged: anyKeyRanged(scriptResult.node),
  };

  return { ok: true, descriptor };
}
