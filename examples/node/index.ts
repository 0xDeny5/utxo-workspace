import { inputWeight, outputWeight, P2WSH_MULTISIG, selectCoins } from "utxo-coinselect";

const result = selectCoins({
  utxos: [
    {
      txid: "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
      vout: 0,
      value: 100_000n,
      weight: inputWeight("p2wpkh"),
      scriptType: "p2wpkh",
      confirmations: 12,
    },
    {
      txid: "f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16",
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
