const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const CHECKSUM_LENGTH = 6;
const MIN_HRP_LENGTH = 1;

function polymod(values: readonly number[]): number {
  let checksum = 1;

  for (const value of values) {
    const top = checksum >>> 25;

    checksum = ((checksum & 0x1ffffff) << 5) ^ value;

    for (let bit = 0; bit < GENERATOR.length; bit += 1) {
      const generatorValue = GENERATOR[bit];

      if (generatorValue !== undefined && ((top >>> bit) & 1) === 1) {
        checksum ^= generatorValue;
      }
    }
  }

  return checksum >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const high: number[] = [];
  const low: number[] = [];

  for (const char of hrp) {
    // Safe by construction: `char` comes from iterating a string, so it is
    // always a non-empty code point.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const code = char.codePointAt(0)!;

    high.push(code >> 5);
    low.push(code & 31);
  }

  return [...high, 0, ...low];
}

/** Exported for direct unit testing of its boundaries; not part of the public barrel. */
export function convertBits(
  data: readonly number[],
  fromBits: number,
  toBits: number,
  pad: boolean,
): number[] | undefined {
  let accumulator = 0;
  let bits = 0;

  const result: number[] = [];
  const maxValue = (1 << toBits) - 1;

  for (const value of data) {
    if (value < 0 || value >>> fromBits !== 0) {
      return undefined;
    }

    accumulator = (accumulator << fromBits) | value;
    bits += fromBits;

    while (bits >= toBits) {
      bits -= toBits;
      result.push((accumulator >>> bits) & maxValue);
    }
  }

  if (pad) {
    if (bits > 0) {
      result.push((accumulator << (toBits - bits)) & maxValue);
    }
  } else if (bits >= fromBits || ((accumulator << (toBits - bits)) & maxValue) !== 0) {
    return undefined;
  }

  return result;
}

export interface DecodedSegwitAddress {
  readonly hrp: string;
  readonly witnessVersion: number;
  readonly program: Uint8Array;
}

export function bech32Decode(address: string): DecodedSegwitAddress | undefined {
  if (address !== address.toLowerCase() && address !== address.toUpperCase()) {
    return undefined;
  }

  const lowered = address.toLowerCase();
  const separatorIndex = lowered.lastIndexOf("1");

  if (separatorIndex < MIN_HRP_LENGTH || lowered.length - separatorIndex - 1 < CHECKSUM_LENGTH) {
    return undefined;
  }

  const hrp = lowered.slice(0, separatorIndex);
  const dataPart = lowered.slice(separatorIndex + 1);
  const values: number[] = [];

  for (const char of dataPart) {
    const value = CHARSET.indexOf(char);

    if (value === -1) {
      return undefined;
    }

    values.push(value);
  }

  const checksum = polymod([...hrpExpand(hrp), ...values]);

  if (checksum !== BECH32_CONST && checksum !== BECH32M_CONST) {
    return undefined;
  }

  const words = values.slice(0, values.length - CHECKSUM_LENGTH);
  const [witnessVersion, ...programWords] = words;

  if (witnessVersion === undefined) {
    return undefined;
  }

  const isBech32m = checksum === BECH32M_CONST;

  if ((witnessVersion === 0) === isBech32m) {
    return undefined;
  }

  const program = convertBits(programWords, 5, 8, false);

  if (program === undefined || program.length < 2 || program.length > 40) {
    return undefined;
  }

  return { hrp, witnessVersion, program: Uint8Array.from(program) };
}
