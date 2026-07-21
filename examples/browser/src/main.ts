import { inputWeight, outputWeight, selectCoins } from "utxo-coinselect";

function serializeBigInt(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

const result = selectCoins({
  utxos: [
    { txid: "aa", vout: 0, value: 80_000n, weight: inputWeight("p2tr") },
    { txid: "bb", vout: 1, value: 50_000n, weight: inputWeight("p2wpkh") },
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
