import { describe, expect, it } from 'vitest';
import { detectLlmWikiSource } from './llmWikiModel';

describe('source field detection', () => {
    it('does not confuse a text File Path with an attachment', () => {
        const result = detectLlmWikiSource({
            id: 'resources', name: 'Resources', properties: [
                { id: 'path', name: 'File Path', type: 'text' },
                { id: 'files', name: 'Arxiu/s', type: 'files' },
                { id: 'wrong', name: 'URL', type: 'formula' },
                { id: 'link', name: 'Link', type: 'text' },
                { id: 'doi', name: 'DOI', type: 'url' },
            ],
        }, null, []);
        expect(result.attachment_property_ids).toEqual(['files']);
        expect(result.url_property_ids).toEqual(['link', 'doi']);
    });
});
