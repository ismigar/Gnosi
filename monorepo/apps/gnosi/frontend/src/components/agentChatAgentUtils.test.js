import { describe, expect, it } from 'vitest';

import { resolveAgentRuntimeSelection } from './agentChatAgentUtils';

describe('embedded agent selection', () => {
    it('keeps the forced notebook agent when the global active profile differs', () => {
        const result = resolveAgentRuntimeSelection(
            [{ id: 'llm-wiki', model: 'devstral-latest' }],
            'gnosy',
            'llm-wiki',
            'llm-wiki',
        );

        expect(result.selectedAgentId).toBe('gnosy');
        expect(result.agent?.id).toBe('llm-wiki');
    });

    it('uses the forced profile configuration when it is available', () => {
        const result = resolveAgentRuntimeSelection(
            [{ id: 'llm-wiki' }, { id: 'gnosy' }],
            'gnosy',
            'llm-wiki',
            'llm-wiki',
        );

        expect(result.selectedAgentId).toBe('gnosy');
        expect(result.agent?.id).toBe('gnosy');
    });
});
