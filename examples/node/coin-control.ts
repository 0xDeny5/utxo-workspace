import { inputWeight, outputWeight, selectCoins } from "utxo-coinselect";

/**
 * Coin-control demo: force one input, freeze another, and require confirmations.
 */
const result = selectCoins({
  utxos: [
    {
      txid: "must-spend",
      vout: 0,
      value: 40_000n,
      weight: inputWeight("p2wpkh"),
      required: true,
      confirmations: 6,
      meta: { label: "forced" },
    },
    {
      txid: "frozen",
      vout: 1,
      value: 500_000n,
      weight: inputWeight("p2wpkh"),
      frozen: true,
      confirmations: 100,
    },
    {
      txid: "unconfirmed",
      vout: 2,
      value: 90_000n,
      weight: inputWeight("p2wpkh"),
      confirmations: 0,
    },
    {
      txid: "available",
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
