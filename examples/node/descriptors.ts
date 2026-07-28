import { selectCoins } from "utxo-coinselect";
import { describeInput, inputWeight, outputWeight, parseDescriptor } from "utxo-descriptors";

/**
 * Descriptors-in, selection-out: price UTXOs and targets from descriptor
 * strings instead of hand-picking a named script type.
 */
interface DescribedUtxo {
  readonly txid: string;
  readonly vout: number;
  readonly value: bigint;
  readonly weight: number;
  /** Used by `preferSingleScriptType`; `utxo-coinselect` treats this as an opaque label. */
  readonly scriptType: string;
}

function priceUtxo(txid: string, vout: number, value: bigint, descriptor: string): DescribedUtxo {
  const parsed = parseDescriptor(descriptor);

  if (!parsed.ok) {
    throw new Error(`${parsed.reason}: ${parsed.message}`);
  }

  const weight = inputWeight(parsed.descriptor.script);
  const description = describeInput(parsed.descriptor.script);

  if (!weight.ok) {
    throw new Error(`${weight.reason}: ${weight.message}`);
  }

  if (!description.ok) {
    throw new Error(`${description.reason}: ${description.message}`);
  }

  const scriptType =
    typeof description.description === "string"
      ? description.description
      : description.description.type;

  return { txid, vout, value, weight: weight.weight, scriptType };
}

function priceTargetOutput(descriptor: string): number {
  const parsed = parseDescriptor(descriptor);

  if (!parsed.ok) {
    throw new Error(`${parsed.reason}: ${parsed.message}`);
  }

  const weight = outputWeight(parsed.descriptor.script);

  if (!weight.ok) {
    throw new Error(`${weight.reason}: ${weight.message}`);
  }

  return weight.weight;
}

const singleSig = priceUtxo(
  "single-sig",
  0,
  100_000n,
  "wpkh(0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798)",
);
const multisig = priceUtxo(
  "multisig",
  1,
  250_000n,
  "wsh(multi(2,02cb674fe0ea2e1e8f79a4e518b8b8ecdff7869f93998fd985637e1317e856da07,03ec2566e4d0b33ed59d5b0ee8c4d0628a776d9d380ac877cfef116d7b6b54c867,024cfa088a9723691a28758550648d756aebe1bbd9a4c3d771bc353541ae762a66))",
);
const targetWeight = priceTargetOutput(
  "tr(63cc121461f39de77043ee0583d261de1381f75dd10ac1fc6a95b8ff20994729)",
);
const result = selectCoins({
  utxos: [singleSig, multisig],
  targets: [{ value: 180_000n, weight: targetWeight }],
  feeRate: 12,
  longTermFeeRate: 3,
  change: {
    outputWeight: targetWeight,
    spendWeight: singleSig.weight,
  },
  strategy: "best",
});

if (!result.ok) {
  throw new Error(`${result.reason}: ${result.message}`);
}

console.log({
  inputs: result.inputs.map((input) => ({ txid: input.txid, vout: input.vout })),
  fee: result.fee.toString(),
  change: result.change.toString(),
  strategy: result.strategy,
  weight: result.weight,
});
