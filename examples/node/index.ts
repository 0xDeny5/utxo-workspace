import { inputWeight, outputWeight, P2WSH_MULTISIG, selectCoins } from "utxo-coinselect";

const result = selectCoins({
  utxos: [
    {
      txid: "single-sig",
      vout: 0,
      value: 100_000n,
      weight: inputWeight("p2wpkh"),
      scriptType: "p2wpkh",
      confirmations: 12,
    },
    {
      txid: "multisig",
      vout: 1,
      value: 250_000n,
      weight: inputWeight(P2WSH_MULTISIG(2, 3)),
      scriptType: "p2wsh-2-of-3",
      confirmations: 144,
    },
  ],
  targets: [{ value: 180_000n, weight: outputWeight("p2tr") }],
  feeRate: 12,
  longTermFeeRate: 3,
  change: {
    outputWeight: outputWeight("p2tr"),
    spendWeight: inputWeight("p2tr"),
  },
  strategy: "best",
});

if (!result.ok) {
  throw new Error(result.message);
}

console.log({
  inputs: result.inputs.map((input) => ({ txid: input.txid, vout: input.vout })),
  fee: result.fee.toString(),
  change: result.change.toString(),
  strategy: result.strategy,
  weight: result.weight,
});
