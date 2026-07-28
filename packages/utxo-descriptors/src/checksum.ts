/**
 * BIP-380 descriptor checksum: a BCH code over a 95-character alphabet split
 * into 3 groups of 32/32/31, using the same 32-character output alphabet as
 * bech32. See https://github.com/bitcoin/bips/blob/master/bip-0380.mediawiki.
 */
const INPUT_CHARSET =
  "0123456789()[],'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#\"\\ ";
const CHECKSUM_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATOR = [0xf5dee51989n, 0xa9fdca3312n, 0x1bab10e32dn, 0x3706b1677an, 0x644d626ffdn];
const CHECKSUM_LENGTH = 8;
const GROUP_SIZE = 3;
const GROUP_BITS = 5;
const GROUP_MASK = 0x7ffffffffn;
const TOP_SHIFT = 35n;
const SYMBOL_MASK = 31;

function polymod(symbols: readonly number[]): bigint {
  let checksum = 1n;

  for (const symbol of symbols) {
    const top = checksum >> TOP_SHIFT;

    checksum = ((checksum & GROUP_MASK) << 5n) ^ BigInt(symbol);

    for (let bit = 0; bit < GENERATOR.length; bit += 1) {
      const generatorValue = GENERATOR[bit];

      if (generatorValue !== undefined && ((top >> BigInt(bit)) & 1n) === 1n) {
        checksum ^= generatorValue;
      }
    }
  }

  return checksum;
}

/** Returns undefined when `text` contains a character outside INPUT_CHARSET. */
function expand(text: string): number[] | undefined {
  const symbols: number[] = [];

  let groupAccumulator = 0;
  let groupCount = 0;

  for (const char of text) {
    const value = INPUT_CHARSET.indexOf(char);

    if (value === -1) {
      return undefined;
    }

    symbols.push(value & SYMBOL_MASK);
    groupAccumulator = groupAccumulator * GROUP_SIZE + (value >> GROUP_BITS);
    groupCount += 1;

    if (groupCount === GROUP_SIZE) {
      symbols.push(groupAccumulator);
      groupAccumulator = 0;
      groupCount = 0;
    }
  }

  if (groupCount > 0) {
    symbols.push(groupAccumulator);
  }

  return symbols;
}

/** Computes the 8-character checksum for a descriptor with no `#` suffix. */
export function checksumCreate(script: string): string | undefined {
  const symbols = expand(script);

  if (symbols === undefined) {
    return undefined;
  }

  const checksum = polymod([...symbols, 0, 0, 0, 0, 0, 0, 0, 0]) ^ 1n;

  let result = "";

  for (let index = 0; index < CHECKSUM_LENGTH; index += 1) {
    const shift = BigInt(GROUP_BITS * (CHECKSUM_LENGTH - 1 - index));
    const symbolIndex = Number((checksum >> shift) & BigInt(SYMBOL_MASK));

    // Safe by construction: SYMBOL_MASK (31) bounds symbolIndex to
    // CHECKSUM_CHARSET's 32 characters.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    result += CHECKSUM_CHARSET[symbolIndex]!;
  }

  return result;
}

/** Verifies an 8-character checksum against the script it was computed from. */
export function checksumVerify(script: string, checksum: string): boolean {
  if (checksum.length !== CHECKSUM_LENGTH) {
    return false;
  }

  const scriptSymbols = expand(script);

  if (scriptSymbols === undefined) {
    return false;
  }

  const checksumSymbols: number[] = [];

  for (const char of checksum) {
    const value = CHECKSUM_CHARSET.indexOf(char);

    if (value === -1) {
      return false;
    }

    checksumSymbols.push(value);
  }

  return polymod([...scriptSymbols, ...checksumSymbols]) === 1n;
}

export function hasValidCharset(text: string): boolean {
  return expand(text) !== undefined;
}
