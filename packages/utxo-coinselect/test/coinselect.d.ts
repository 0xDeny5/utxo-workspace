// Minimal types for the reference `coinselect` package (dev dependency, used by
// the compat differential tests only).
declare module "coinselect" {
  export interface ReferenceResult<U, O> {
    readonly inputs?: U[];
    readonly outputs?: (O | { value: number })[];
    readonly fee: number;
  }

  export default function coinSelect<U, O>(
    utxos: readonly U[],
    outputs: readonly O[],
    feeRate: number,
  ): ReferenceResult<U, O>;
}

declare module "coinselect/accumulative" {
  import type { ReferenceResult } from "coinselect";

  export default function accumulative<U, O>(
    utxos: readonly U[],
    outputs: readonly O[],
    feeRate: number,
  ): ReferenceResult<U, O>;
}

declare module "coinselect/blackjack" {
  import type { ReferenceResult } from "coinselect";

  export default function blackjack<U, O>(
    utxos: readonly U[],
    outputs: readonly O[],
    feeRate: number,
  ): ReferenceResult<U, O>;
}

declare module "coinselect/split" {
  import type { ReferenceResult } from "coinselect";

  export default function split<U, O>(
    utxos: readonly U[],
    outputs: readonly O[],
    feeRate: number,
  ): ReferenceResult<U, O>;
}
