import { inputWeight, outputWeight, selectCoins, type StrategyName } from "utxo-coinselect";

/**
 * Run several strategies on the same wallet snapshot and print fee / waste / strategy used.
 */
const shared = {
  utxos: [
    {
      txid: "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
      vout: 0,
      value: 30_000n,
      weight: inputWeight("p2wpkh"),
      timestamp: 1,
    },
    {
      txid: "f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16",
      vout: 0,
      value: 45_000n,
      weight: inputWeight("p2wpkh"),
      timestamp: 2,
    },
    {
      txid: "a1075db55d416d3eda53448fb8a51ba2fe7967bf365d852df5583e8cbb12e4a7",
      vout: 0,
      value: 60_000n,
      weight: inputWeight("p2wpkh"),
      timestamp: 3,
    },
    {
      txid: "b10c0ea393bd7ef27cf147f41d572b0786b63df557d0982f978ce7e1581839280",
      vout: 0,
      value: 90_000n,
      weight: inputWeight("p2tr"),
      timestamp: 4,
    },
    {
      txid: "d5d279df34e97014a56664e3fde72558a5048e21e7f8fbc3872125fc12608e45",
      vout: 0,
      value: 101_200n,
      weight: inputWeight("p2wpkh"),
      timestamp: 5,
    },
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
