import { describe, expect, it } from 'vitest';

import { chatScrollDeltaForComposerKey } from './agentChatKeyboardUtils';

describe('chatScrollDeltaForComposerKey', () => {
    it.each([
        [{ key: 'ArrowUp', value: '' }, -120],
        [{ key: 'ArrowDown', value: '' }, 120],
        [{ key: 'ArrowUp', value: 'Draft message' }, 0],
        [{ key: 'ArrowDown', value: '', shiftKey: true }, 0],
        [{ key: 'Enter', value: '' }, 0],
    ])('returns %i only for unmodified arrows in an empty composer', (event, expected) => {
        expect(chatScrollDeltaForComposerKey(event)).toBe(expected);
    });
});
