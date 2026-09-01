import { describe, expect, it } from 'vitest';
import { acceptStreamSequence } from './streamSequence';

describe('agent stream sequence envelope', () => {
  it('accepts only newer integer sequences', () => {
    expect(acceptStreamSequence(1, 0)).toEqual({ accepted: true, sequence: 1 });
    expect(acceptStreamSequence(1, 1)).toEqual({ accepted: false, sequence: 1 });
    expect(acceptStreamSequence(0, 1)).toEqual({ accepted: false, sequence: 1 });
    expect(acceptStreamSequence(3, 1)).toEqual({ accepted: true, sequence: 3 });
  });
  it.each([undefined, null, '2', 1.5, Number.NaN])('keeps legacy payload sequence %s compatible', (value) => {
    expect(acceptStreamSequence(value, 4)).toEqual({ accepted: true, sequence: 4 });
  });
});
