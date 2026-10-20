import { describe, expect, it } from 'vitest';
import { boundedGauntlet, boundedTransparencyMetadata } from './agentChatTransparency';
import { mergeCanonicalMessageMetadata } from './agentChatConversationMerge';

const accepted = { status: 'accepted', rounds: 2, finding_count: 0, stop_reason: 'accepted' };

describe('bounded quality review metadata', () => {
  it.each([
    accepted,
    { status: 'stagnated', rounds: 3, finding_count: 2, stop_reason: 'stagnated' },
    ...['budget', 'unavailable', 'invalid_review', 'interrupted', 'unverified_evidence', 'action_review']
      .map(stop_reason => ({ status: 'incomplete', rounds: 0, finding_count: 1, stop_reason })),
  ])('preserves the public summary for $status/$stop_reason without private review material', summary => {
    const input = { ...summary, findings: [{ text: 'PRIVATE-FINDING' }], candidate: 'PRIVATE-CANDIDATE',
      source: { text: 'PRIVATE-SOURCE' }, request: 'PRIVATE-REQUEST' };
    const normalized = boundedTransparencyMetadata({ gauntlet: input });
    expect(normalized.gauntlet).toEqual(summary);
    expect(boundedTransparencyMetadata(normalized).gauntlet).toEqual(summary);
    expect(JSON.stringify(normalized)).not.toContain('PRIVATE-');
    expect(input.candidate).toBe('PRIVATE-CANDIDATE');
  });

  it.each([
    null, [], 'accepted', {},
    { ...accepted, status: 'unknown' }, { ...accepted, status: { accepted: true } },
    { ...accepted, stop_reason: 'private text' }, { ...accepted, stop_reason: ['accepted'] },
    { ...accepted, finding_count: 1 }, { ...accepted, stop_reason: 'budget' }, { ...accepted, rounds: 0 },
    { ...accepted, status: 'stagnated' }, { ...accepted, status: 'incomplete' },
    ...[-1, 1.5, true, '2', Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, null]
      .flatMap(count => [{ ...accepted, rounds: count }, { ...accepted, finding_count: count }]),
  ])('omits malformed summaries instead of presenting acceptance: %j', value => {
    expect(boundedGauntlet(value)).toBeNull();
  });

  it('prefers the canonical review over stale local acceptance and bounds either source', () => {
    const local = [{ role: 'assistant', content: 'Answer', turnId: 'turn', gauntlet: { ...accepted, findings: ['PRIVATE'] } }];
    const message = { role: 'assistant', content: 'Answer', turn_id: 'turn' };
    const incomplete = { status: 'incomplete', rounds: 3, finding_count: 1, stop_reason: 'budget' };
    expect(mergeCanonicalMessageMetadata([message], local)[0]).toMatchObject({ gauntlet: accepted });
    expect(mergeCanonicalMessageMetadata([{ ...message, gauntlet: incomplete }], local)[0]).toMatchObject({ gauntlet: incomplete });
    for (const gauntlet of [null, { ...accepted, status: 'invalid' }]) {
      expect(mergeCanonicalMessageMetadata([{ ...message, gauntlet }], local)[0]).toMatchObject({ gauntlet: null });
    }
    const result = mergeCanonicalMessageMetadata([{ ...message, gauntlet: { ...accepted, request: 'PRIVATE' } }], []);
    expect(result[0]).toMatchObject({ gauntlet: accepted });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('never transfers a cached review to another turn or another answer through legacy role matching', () => {
    const local = [{ role: 'assistant', content: 'Reviewed answer', turnId: 'first', gauntlet: accepted }];
    for (const canonical of [
      { role: 'assistant', content: 'Reviewed answer', turn_id: 'second' },
      { role: 'assistant', content: 'Changed answer', turn_id: 'first' },
      { role: 'assistant', content: 'Unrelated answer' },
    ]) expect(mergeCanonicalMessageMetadata([canonical], local)[0]).toMatchObject({ gauntlet: null });
    expect(mergeCanonicalMessageMetadata([{ role: 'assistant', content: 'Reviewed answer' }], local)[0])
      .toMatchObject({ gauntlet: accepted });
  });
});
