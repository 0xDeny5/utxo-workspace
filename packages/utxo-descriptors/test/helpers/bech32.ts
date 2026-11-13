/**
 * A minimal bech32/bech32m encoder, kept in test code only, used to construct
 * the (valid and malformed) addresses needed to exercise `bech32Decode`.
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

export function bech32Encode(hrp: string, words: readonly number[], useBech32m: boolean): string {
  const targetConst = useBech32m ? 0x2bc830a3 : 1;
  const polymodInput = [...bech32HrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0];
  const mod = bech32Polymod(polymodInput) ^ targetConst;
  const checksumWords = Array.from({ length: 6 }, (_, index) => (mod >>> (5 * (5 - index))) & 31);
  const dataChars = [...words, ...checksumWords].map((word) => BECH32_CHARSET[word] ?? "").join("");

  return `${hrp}1${dataChars}`;
}
