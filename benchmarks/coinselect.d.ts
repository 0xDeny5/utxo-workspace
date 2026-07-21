declare module "coinselect" {
  export interface LegacyUtxo {
    readonly value: number;
  }

  export interface LegacyTarget {
    readonly value: number;
  }

  export interface LegacyResult {
    readonly inputs?: readonly LegacyUtxo[];
    readonly outputs?: readonly LegacyTarget[];
    readonly fee: number;
  }

  export default function coinselect(
    utxos: readonly LegacyUtxo[],
    targets: readonly LegacyTarget[],
    feeRate: number,
  ): LegacyResult;
}
