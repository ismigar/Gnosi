export interface StreamSequenceResult {
  readonly accepted: boolean;
  readonly sequence: number;
}

/** Unsequenced legacy events remain valid; envelope retries never replay a turn. */
export function acceptStreamSequence(value: unknown, previous: number): StreamSequenceResult {
  if (typeof value !== 'number' || !Number.isInteger(value)) return { accepted: true, sequence: previous };
  return { accepted: value > previous, sequence: value > previous ? value : previous };
}
