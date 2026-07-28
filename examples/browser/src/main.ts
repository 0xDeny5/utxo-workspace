import { inputWeight, outputWeight, selectCoins } from "utxo-coinselect";

function serializeBigInt(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

const result = selectCoins({
  utxos: [
    {
      txid: "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
      vout: 0,
      value: 80_000n,
      weight: inputWeight("p2tr"),
    },
    {
      txid: "a1075db55d416d3eda53448fb8a51ba2fe7967bf365d852df5583e8cbb12e4a7",
      vout: 1,
      value: 50_000n,
      weight: inputWeight("p2wpkh"),
    },
  ],
  targets: [{ value: 75_000n, weight: outputWeight("p2tr") }],
  feeRate: 5,
  change: {
    outputWeight: outputWeight("p2tr"),
    spendWeight: inputWeight("p2tr"),
  },
});
const element = document.querySelector("#result");

if (element !== null) {
  element.textContent = JSON.stringify(result, serializeBigInt, 2);
}
