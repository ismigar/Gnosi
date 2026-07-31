import { describe, expect, it } from 'vitest';

import { selectedMentionsInText, visibleMentionToken } from './agentChatMentionUtils';

describe('assistant chat visible mentions', () => {
    it('inserts a resource label without exposing its identifier', () => {
        expect(visibleMentionToken('Projectes')).toBe('@Projectes');
    });

    it('sends only selected mentions that remain in the composer', () => {
        const selectedMentions = [
            { type: 'page', id: 'page-1', label: 'Pla de futur', token: '@Pla de futur' },
            { type: 'table', id: 'table-1', label: 'Projectes', token: '@Projectes' },
        ];

        expect(selectedMentionsInText(
            'Revisa @Projectes, si us plau.',
            selectedMentions,
        )).toEqual([
            { type: 'table', id: 'table-1', label: 'Projectes' },
        ]);
    });
});
