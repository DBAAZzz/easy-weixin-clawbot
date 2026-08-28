export interface SequencePage {
  afterSeq?: number;
  throughSeq?: number;
  limit: number;
}

export function validateSequencePage(input: SequencePage): void {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500) {
    throw new RangeError("Fact ledger page limit must be an integer between 1 and 500");
  }
  if (input.afterSeq !== undefined && (!Number.isInteger(input.afterSeq) || input.afterSeq < 0)) {
    throw new RangeError("Fact ledger afterSeq must be a non-negative integer");
  }
  if (
    input.throughSeq !== undefined &&
    (!Number.isInteger(input.throughSeq) || input.throughSeq < 1)
  ) {
    throw new RangeError("Fact ledger throughSeq must be a positive integer");
  }
}

export function sequenceRange(input: SequencePage): { gt?: number; lte?: number } {
  return {
    ...(input.afterSeq === undefined ? {} : { gt: input.afterSeq }),
    ...(input.throughSeq === undefined ? {} : { lte: input.throughSeq }),
  };
}
