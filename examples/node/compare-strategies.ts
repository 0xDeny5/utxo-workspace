import { inputWeight, outputWeight, selectCoins, type StrategyName } from "utxo-coinselect";

/**
 * Run several strategies on the same wallet snapshot and print fee / waste / strategy used.
 */
const shared = {
  utxos: [
    { txid: "a", vout: 0, value: 30_000n, weight: inputWeight("p2wpkh"), timestamp: 1 },
    { txid: "b", vout: 0, value: 45_000n, weight: inputWeight("p2wpkh"), timestamp: 2 },
    { txid: "c", vout: 0, value: 60_000n, weight: inputWeight("p2wpkh"), timestamp: 3 },
    { txid: "d", vout: 0, value: 90_000n, weight: inputWeight("p2tr"), timestamp: 4 },
    { txid: "exactish", vout: 0, value: 101_200n, weight: inputWeight("p2wpkh"), timestamp: 5 },
  ],
  targets: [{ value: 100_000n, weight: outputWeight("p2wpkh") }] as const,
  feeRate: 8,
  longTermFeeRate: 2,
  change: {
    outputWeight: outputWeight("p2wpkh"),
    spendWeight: inputWeight("p2wpkh"),
  },
  seed: 7,
};
const strategies: StrategyName[] = [
  "best",
  "branch-and-bound",
  "accumulative",
  "blackjack",
  "largest-first",
  "smallest-first",
  "knapsack",
  "single-random-draw",
];

for (const strategy of strategies) {
  const result = selectCoins({ ...shared, strategy });

  if (!result.ok) {
    console.log(strategy.padEnd(20), "FAILED", result.reason);
    continue;
  }

  console.log(
    strategy.padEnd(20),
    `fee=${result.fee.toString().padStart(5)}`,
    `waste=${result.waste.toString().padStart(5)}`,
    `inputs=${String(result.inputs.length)}`,
    `used=${result.strategy}`,
  );
}
