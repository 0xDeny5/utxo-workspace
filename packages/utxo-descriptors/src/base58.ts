const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE = 58n;
const BYTE_MAX_PLUS_ONE = 256n;
const CHAR_TO_VALUE = new Map<string, bigint>(
  ALPHABET.split("").map((char, index) => [char, BigInt(index)]),
);

/**
 * Decodes base58 text into raw bytes without verifying (or removing) any
 * trailing checksum. This package never needs SHA256, so callers that need
 * checksum verification must bring their own; see the README for the exact
 * limitation this implies for `addr()` base58 addresses.
 */
export function base58Decode(text: string): Uint8Array | undefined {
  if (text.length === 0) {
    return undefined;
  }

  let value = 0n;

  for (const char of text) {
    const digit = CHAR_TO_VALUE.get(char);

    if (digit === undefined) {
      return undefined;
    }

    value = value * BASE + digit;
  }

  const bytes: number[] = [];

  while (value > 0n) {
    bytes.unshift(Number(value % BYTE_MAX_PLUS_ONE));
    value /= BYTE_MAX_PLUS_ONE;
  }

  for (const char of text) {
    if (char !== "1") {
      break;
    }

    bytes.unshift(0);
  }

  return Uint8Array.from(bytes);
}
