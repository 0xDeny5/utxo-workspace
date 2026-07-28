/**
 * Throughput smoke benchmark — not a fee-quality contest.
 *
 * `utxo-coinselect best` runs several algorithms (meta-selector) and is expected to be slower.
 * `utxo-coinselect accumulative` is closer to bitcoinjs/coinselect's workload.
 */
import type { OutputWithValue } from "@bitcoinerlab/coinselect";
import { coinselect as bitcoinerlabSelect } from "@bitcoinerlab/coinselect";
import type { OutputInstance } from "@bitcoinerlab/descriptors";
import { DescriptorsFactory } from "@bitcoinerlab/descriptors";
import * as secp256k1 from "@bitcoinerlab/secp256k1";
import type { LegacyTarget, LegacyUtxo } from "coinselect";
import legacyCoinselect from "coinselect";
import { Bench } from "tinybench";

import {
  inputWeight,
  outputWeight,
  selectCoins,
  type SelectionRequest,
  type Utxo,
} from "../packages/utxo-coinselect/src";
import {
  inputWeight as descriptorInputWeight,
  parseDescriptor,
} from "../packages/utxo-descriptors/src";

const UTXO_COUNT = 100;
const TARGET_VALUE = 500_000;
const FEE_RATE = 5;
const BENCH_TIME_MS = 750;
const BENCH_WARMUP_MS = 100;
const values: readonly number[] = Array.from(
  { length: UTXO_COUNT },
  (_, index) => 10_000 + index * 137,
);
const p2wpkhInputWeight = inputWeight("p2wpkh");
const p2wpkhOutputWeight = outputWeight("p2wpkh");
const modernUtxos: readonly Utxo[] = values.map((value, index) => ({
  txid: String(index),
  vout: 0,
  value: BigInt(value),
  weight: p2wpkhInputWeight,
}));
const modernBestRequest = {
  utxos: modernUtxos,
  targets: [{ value: BigInt(TARGET_VALUE), weight: p2wpkhOutputWeight }],
  feeRate: FEE_RATE,
  change: {
    outputWeight: p2wpkhOutputWeight,
    spendWeight: p2wpkhInputWeight,
  },
  strategy: "best",
  seed: 1,
} as const satisfies SelectionRequest;
const modernAccumRequest = {
  ...modernBestRequest,
  strategy: "accumulative",
} as const satisfies SelectionRequest;
const legacyUtxos: readonly LegacyUtxo[] = values.map((value) => ({ value }));
const legacyTargets: readonly LegacyTarget[] = [{ value: TARGET_VALUE }];
const { Output } = DescriptorsFactory(secp256k1);
const descriptor = "addr(bc1qzne9qykh9j55qt8ccqamusp099spdfr49tje60)" as const;
const remainder: OutputInstance = new Output({ descriptor });
const labUtxos: readonly OutputWithValue[] = values.map((value) => ({
  output: new Output({ descriptor }),
  value: BigInt(value),
}));
const labTargets: readonly OutputWithValue[] = [
  {
    output: new Output({ descriptor }),
    value: BigInt(TARGET_VALUE),
  },
];
const benchmark = new Bench({ time: BENCH_TIME_MS, warmupTime: BENCH_WARMUP_MS });

benchmark
  .add("utxo-coinselect best", () => {
    selectCoins(modernBestRequest);
  })
  .add("utxo-coinselect accumulative", () => {
    selectCoins(modernAccumRequest);
  })
  .add("bitcoinjs/coinselect", () => {
    legacyCoinselect(legacyUtxos, legacyTargets, FEE_RATE);
  })
  .add("@bitcoinerlab/coinselect", () => {
    bitcoinerlabSelect({
      utxos: [...labUtxos],
      targets: [...labTargets],
      remainder,
      feeRate: FEE_RATE,
    });
  });

await benchmark.run();
console.table(benchmark.table());

/**
 * `utxo-descriptors` has no derivation step and no cache to warm, so the fair
 * comparison is bitcoinerlab's full "construct + price" cost, which is what a
 * caller pays per UTXO the first time it sees that descriptor. The pre-built
 * `Output` case is included only to show how much of bitcoinerlab's cost is
 * paid once at construction versus per `inputWeight()` call.
 */
const wpkhDescriptor = "wpkh(0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798)";
const bitcoinerlabWpkhOutput: OutputInstance = new Output({ descriptor: wpkhDescriptor });
const descriptorsBenchmark = new Bench({ time: BENCH_TIME_MS, warmupTime: BENCH_WARMUP_MS });

descriptorsBenchmark
  .add("utxo-descriptors: parse + inputWeight", () => {
    const parsed = parseDescriptor(wpkhDescriptor);

    if (!parsed.ok) {
      throw new Error(parsed.message);
    }

    const weight = descriptorInputWeight(parsed.descriptor.script);

    if (!weight.ok) {
      throw new Error(weight.message);
    }
  })
  .add("@bitcoinerlab/descriptors: construct + inputWeight", () => {
    const output: OutputInstance = new Output({ descriptor: wpkhDescriptor });

    output.inputWeight(true, "DANGEROUSLY_USE_FAKE_SIGNATURES");
  })
  .add("@bitcoinerlab/descriptors: inputWeight on a pre-built Output", () => {
    bitcoinerlabWpkhOutput.inputWeight(true, "DANGEROUSLY_USE_FAKE_SIGNATURES");
  });

await descriptorsBenchmark.run();
console.table(descriptorsBenchmark.table());
