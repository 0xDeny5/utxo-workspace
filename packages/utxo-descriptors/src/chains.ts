/**
 * Chain parameters as data, not code. `addr()` output weight only needs the
 * base58 version bytes (bech32 addresses carry no chain-specific information
 * relevant to weight). Add a chain by constructing a new `ChainParams`
 * object; nothing else in this package needs to change.
 */
export interface ChainParams {
  readonly name: string;
  readonly bech32Hrp: string;
  readonly base58PubKeyHash: number;
  readonly base58ScriptHash: number;
}

export const BITCOIN: ChainParams = {
  name: "bitcoin",
  bech32Hrp: "bc",
  base58PubKeyHash: 0x00,
  base58ScriptHash: 0x05,
};

export const BITCOIN_TESTNET: ChainParams = {
  name: "bitcoin-testnet",
  bech32Hrp: "tb",
  base58PubKeyHash: 0x6f,
  base58ScriptHash: 0xc4,
};

export const LITECOIN: ChainParams = {
  name: "litecoin",
  bech32Hrp: "ltc",
  base58PubKeyHash: 0x30,
  base58ScriptHash: 0x32,
};

export const LITECOIN_TESTNET: ChainParams = {
  name: "litecoin-testnet",
  bech32Hrp: "tltc",
  base58PubKeyHash: 0x6f,
  base58ScriptHash: 0x3a,
};
