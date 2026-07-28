import { inputWeight, outputWeight, selectCoins } from "utxo-coinselect";

/**
 * Coin-control demo: force one input, freeze another, and require confirmations.
 */
const result = selectCoins({
  utxos: [
    {
      txid: "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
      vout: 0,
      value: 40_000n,
      weight: inputWeight("p2wpkh"),
      required: true,
      confirmations: 6,
      meta: { label: "forced" },
    },
    {
      txid: "f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16",
      vout: 1,
      value: 500_000n,
      weight: inputWeight("p2wpkh"),
      frozen: true,
      confirmations: 100,
    },
    {
      txid: "a1075db55d416d3eda53448fb8a51ba2fe7967bf365d852df5583e8cbb12e4a7",
      vout: 2,
      value: 90_000n,
      weight: inputWeight("p2wpkh"),
      confirmations: 0,
    },
    {
      txid: "b10c0ea393bd7ef27cf147f41d572b0786b63df557d0982f978ce7e1581839280",
      vout: 3,
      value: 80_000n,
      weight: inputWeight("p2wpkh"),
      confirmations: 3,
      scriptType: "p2wpkh",
    },
  ],
  targets: [{ value: 100_000n, weight: outputWeight("p2wpkh") }],
  feeRate: 4,
  minConfirmations: 1,
  change: {
    outputWeight: outputWeight("p2wpkh"),
    spendWeight: inputWeight("p2wpkh"),
  },
  strategy: "largest-first",
});

if (!result.ok) {
  throw new Error(`${result.reason}: ${result.message}`);
}

console.log({
  inputs: result.inputs.map((input) => ({ txid: input.txid, vout: input.vout })),
  meta: result.inputs.map((input) => input.meta),
  fee: result.fee.toString(),
  change: result.change.toString(),
});
