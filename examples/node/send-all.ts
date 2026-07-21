import { inputWeight, outputWeight, selectCoins } from "utxo-coinselect";

/**
 * Send-all demo using the split strategy.
 * Provide exactly one target without a value; it receives the post-fee remainder.
 */
const result = selectCoins({
  utxos: [
    { txid: "aa", vout: 0, value: 75_000n, weight: inputWeight("p2tr") },
    { txid: "bb", vout: 1, value: 40_000n, weight: inputWeight("p2tr") },
  ],
  targets: [{ weight: outputWeight("p2tr") }],
  feeRate: 3,
  strategy: "split",
});

if (!result.ok) {
  throw new Error(`${result.reason}: ${result.message}`);
}

const outputSum = result.outputs.reduce((sum, output) => sum + output.value, 0n);
const inputSum = result.inputs.reduce((sum, input) => sum + input.value, 0n);

console.log({
  inputs: result.inputs.map((input) => ({ txid: input.txid, vout: input.vout })),
  outputs: result.outputs.map((output) => output.value.toString()),
  fee: result.fee.toString(),
  balanced: inputSum === outputSum + result.fee,
});
