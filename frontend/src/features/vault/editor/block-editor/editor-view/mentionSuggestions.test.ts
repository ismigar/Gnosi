import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Contact } from '../../../../../shared/api/contacts';
import { mentionSuggestions } from './mentionSuggestions';
import { menuItem, translationsReady, viewInputs } from './test-support';

beforeAll(async () => { await translationsReady; });
afterEach(() => { vi.useRealTimers(); });

function contact(id: string, name: string): Contact {
    return { id, name, email: `${id}@example.test`, address: null, addresses: [], apple_resource_id: null,
        company: null, created_at: null, emails: [], google_resource_name: null, job_title: null, last_synced_at: null,
        notes: null, phone: null, phones: [], photo_url: null, source: 'local', tags: [], type: 'person', updated_at: null, workspace_id: 'test',
    };
}

describe('editor mention and date suggestions', () => {
    it('offers today/tomorrow/yesterday with local ISO dates and the original inline payload', async () => {
        const inputs = viewInputs();
        const insert = vi.spyOn(inputs.editor, 'insertInlineContent').mockImplementation(() => undefined);
        vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 7, 30, 12));
        const items = await mentionSuggestions('', inputs);
        expect(items.map(item => item.title)).toEqual(['Today', 'Tomorrow', 'Yesterday']);
        expect(items.map(item => item.subtext)).toEqual(['2026-08-30', '2026-08-31', '2026-08-29']);
        menuItem(items, 'Tomorrow').onItemClick();
        expect(insert).toHaveBeenCalledWith([{ type: 'dateref', props: { date: '2026-08-31', time: '' } }, ' ']);
        expect(inputs.loadContacts).toHaveBeenCalledWith({});
    });

    it('matches translated shortcut keywords and retains explicit YYYY-MM-DD insertion', async () => {
        const inputs = viewInputs();
        const insert = vi.spyOn(inputs.editor, 'insertInlineContent').mockImplementation(() => undefined);
        expect((await mentionSuggestions('demà', inputs)).map(item => item.title)).toEqual(['Tomorrow']);
        const items = await mentionSuggestions(' 2026-09-03 ', inputs);
        menuItem(items, '2026-09-03').onItemClick();
        expect(insert).toHaveBeenCalledWith([{ type: 'dateref', props: { date: '2026-09-03', time: '' } }, ' ']);
        expect(inputs.loadContacts).toHaveBeenLastCalledWith({ search: '2026-09-03' });
    });

    it('limits contact candidates to eight, skips blank names, and keeps the contact id/name', async () => {
        const inputs = viewInputs();
        const insert = vi.spyOn(inputs.editor, 'insertInlineContent').mockImplementation(() => undefined);
        inputs.loadContacts.mockResolvedValue([contact('empty', ' '), ...Array.from({ length: 10 }, (_, i) => contact(String(i), ` Mercè ${String(i)} `))]);
        const items = await mentionSuggestions('merc', inputs);
        expect(items).toHaveLength(7);
        menuItem(items, 'Mercè 0').onItemClick();
        expect(insert).toHaveBeenCalledWith([{ type: 'mention', props: { id: '0', name: 'Mercè 0' } }, ' ']);
        expect(items[0]?.subtext).toBe('0@example.test');
    });

    it('keeps date suggestions when the optional contacts provider fails', async () => {
        const inputs = viewInputs(); inputs.loadContacts.mockRejectedValue(new Error('offline'));
        expect((await mentionSuggestions('today', inputs)).map(item => item.title)).toEqual(['Today']);
    });
});
