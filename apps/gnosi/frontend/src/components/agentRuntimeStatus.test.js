import { describe, expect, it } from 'vitest';

import { deriveAgentRuntimeStatus } from './agentRuntimeStatus';

describe('assistant runtime status', () => {
    it('explains when assigned skills are blocked by the model', () => {
        expect(deriveAgentRuntimeStatus({
            active_skill_ids: ['core.gnosi-vault'],
            supports_tools: false,
            tool_count: 0,
        }, true)).toMatchObject({
            kind: 'model_no_tools',
            limited: true,
            ids: ['core.gnosi-vault'],
        });
    });

    it('shows the exact usable tool count for a healthy runtime', () => {
        expect(deriveAgentRuntimeStatus({
            active_skill_ids: ['core.gnosi-vault'],
            supports_tools: true,
            tool_count: 35,
        }, true)).toEqual({
            kind: 'ready',
            limited: false,
            count: 35,
            ids: [],
        });
    });

    it('prioritizes missing skills over unavailable tools', () => {
        expect(deriveAgentRuntimeStatus({
            supports_tools: true,
            missing_skill_ids: ['plugin.missing.query'],
            unavailable_tool_ids: ['plugin.missing.tool'],
        }, true)).toMatchObject({ kind: 'missing_skills', limited: true });
    });
});
