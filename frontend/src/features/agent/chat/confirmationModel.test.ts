import { describe, expect, it } from 'vitest';
import { confirmationDetailRecord, confirmationScope, formatConfirmationValue } from './confirmationModel';

describe('confirmation scope and review model', () => {
  it('prefers the explicit originating client scope', () => {
    expect(confirmationScope({ client_scope: 'origin:a:s', agent_id: 'b', session_id: 't' }, 'current')).toBe('origin:a:s');
  });
  it('requires both agent and session when rebuilding the scope', () => {
    expect(confirmationScope({ agent_id: 'a', session_id: 's' }, 'vault:workspace:user')).toBe('vault:workspace:user:a:s');
    expect(confirmationScope({ agent_id: 'a' }, 'vault')).toBe('');
    expect(confirmationScope(null)).toBe('');
  });
  it('preserves readable values without treating objects as executable content', () => {
    expect(formatConfirmationValue(null)).toBe('—');
    expect(formatConfirmationValue(false)).toBe('false');
    expect(formatConfirmationValue({ title: '<script>text</script>' })).toBe(`{
  "title": "<script>text</script>"
}`);
    expect(confirmationDetailRecord(42)).toEqual({});
  });
});
