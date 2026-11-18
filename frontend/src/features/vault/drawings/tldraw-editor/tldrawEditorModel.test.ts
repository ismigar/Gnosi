import { describe, expect, it } from 'vitest';

import {
    parseDroppedCanvasNote,
} from './tldrawEditorModel';

describe('tldrawEditorModel', () => {
    it('validates dropped Vault page payloads before using them', () => {
        expect(parseDroppedCanvasNote(JSON.stringify({
            id: 'page-1',
            title: 'Evidence',
        }))).toEqual({ id: 'page-1', title: 'Evidence' });
        expect(() => parseDroppedCanvasNote('{"title":"Missing id"}'))
            .toThrow('Dropped Vault note has no id');
    });
});
