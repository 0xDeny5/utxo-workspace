import { hasValidCharset } from "./checksum";

export type TokenKind = "lparen" | "rparen" | "comma" | "lbrace" | "rbrace" | "atom";

/**
 * A lexical token. `atom` tokens capture everything between structural
 * delimiters as one unit: function names, numbers, hex, WIF/xpub/xprv key
 * material, key origins, and multipath specifiers never contain `(`, `)`,
 * `,`, `{`, or `}`, so this greedy grouping is unambiguous without regex.
 */
export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly position: number;
}

export interface TokenizeSuccess {
  readonly ok: true;
  readonly tokens: readonly Token[];
}

export interface TokenizeFailure {
  readonly ok: false;
  readonly position: number;
}

export type TokenizeResult = TokenizeSuccess | TokenizeFailure;

const STRUCTURAL: Readonly<Record<string, TokenKind>> = {
  "(": "lparen",
  ")": "rparen",
  ",": "comma",
  "{": "lbrace",
  "}": "rbrace",
};

export function tokenize(text: string): TokenizeResult {
  const tokens: Token[] = [];

  let index = 0;

  while (index < text.length) {
    // Safe by construction: bounded by the `index < text.length` guard.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const char = text[index]!;
    const structuralKind = STRUCTURAL[char];

    if (structuralKind !== undefined) {
      tokens.push({ kind: structuralKind, text: char, position: index });
      index += 1;

      continue;
    }

    const start = index;

    let atom = "";

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    while (index < text.length && STRUCTURAL[text[index]!] === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const atomChar = text[index]!;

      if (!hasValidCharset(atomChar)) {
        return { ok: false, position: index };
      }

      atom += atomChar;
      index += 1;
    }

    tokens.push({ kind: "atom", text: atom, position: start });
  }

  return { ok: true, tokens };
}
