import { expect, it } from 'vitest';
import { boundedMemoryProvenance } from './memoryProvenance';
it('keeps exact selected revision and expiration for a scoped correction', () => {
  expect(boundedMemoryProvenance([{ memory_id: 'm', agent_id: 'agent', text: 'Captured memory', revision: 4, enabled: false, expires_at: '2030-01-01', scope_kind: 'project', scope_id: 'p' }])[0]).toMatchObject({ revision: 4, scope_kind: 'project', scope_id: 'p', enabled: false, expires_at: '2030-01-01' });
  expect(boundedMemoryProvenance([null, { text: 'missing identity' }])).toEqual([]);
});
