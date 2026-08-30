import { AtSign, Calendar as CalendarIcon } from 'lucide-react';
import type { EditorMenuItem, MentionMenuInputs } from './types';

export async function mentionSuggestions(query: string, { editor, t, loadContacts }: MentionMenuInputs): Promise<EditorMenuItem[]> {
    const q = (query || '').trim();
    const ql = q.toLowerCase();
    const items: EditorMenuItem[] = [];
    const pad = (n: number) => String(n).padStart(2, '0');
    const isoLocal = (d: Date) => `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const now = new Date();
    const insertDate = (date: string) => { editor.insertInlineContent([{ type: 'dateref', props: { date, time: '' } }, ' ']); };
    const insertMention = (id: string, name: string) => { editor.insertInlineContent([{ type: 'mention', props: { id, name } }, ' ']); };

    // Date shortcuts (Notion style: @today, @tomorrow, @yesterday).
    const shortcuts = [
        { label: t('editor.date_today', { defaultValue: "Today" }), offset: 0, kw: ['avui', 'today', 'hoy'] },
        { label: t('editor.date_tomorrow', { defaultValue: "Tomorrow" }), offset: 1, kw: ['dema', 'demà', 'tomorrow', 'manana'] },
        { label: t('editor.date_yesterday', { defaultValue: "Yesterday" }), offset: -1, kw: ['ahir', 'yesterday', 'ayer'] },
    ];
    for (const sc of shortcuts) {
        if (ql && !sc.kw.some(k => k.includes(ql)) && !sc.label.toLowerCase().includes(ql)) continue;
        const d = new Date(now.getTime() + sc.offset * 86400000);
        const iso = isoLocal(d);
        items.push({
            title: sc.label,
            aliases: [...sc.kw, 'data', 'date', 'recordatori', 'reminder'],
            group: t('editor.dates_group', { defaultValue: 'Dates' }),
            icon: <CalendarIcon size={18} />,
            subtext: iso,
            onItemClick: () => { insertDate(iso); },
        });
    }
    // Explicitly written date (YYYY-MM-DD).
    if (/^\d{4}-\d{2}-\d{2}$/.test(q)) {
        items.push({
            title: q,
            aliases: ['data', 'date'],
            group: t('editor.dates_group', { defaultValue: 'Dates' }),
            icon: <CalendarIcon size={18} />,
            subtext: t('editor.insert_this_date', { defaultValue: "Insert this date" }),
            onItemClick: () => { insertDate(q); },
        });
    }
    // Contacts (people).
    try {
        const contacts = await loadContacts(q ? { search: q } : {});
        for (const c of contacts.slice(0, 8)) {
            const name = (c.name || '').trim();
            if (!name) continue;
            items.push({
                title: name,
                aliases: [(c.email || ''), 'persona', 'people', 'mention'],
                group: t('editor.people_group', { defaultValue: "People" }),
                icon: <AtSign size={18} />,
                subtext: c.email || t('editor.contact', { defaultValue: "Contact" }),
                onItemClick: () => { insertMention((c.id || ''), name); },
            });
        }
    } catch { /* optional contacts: if it fails, only dates */ }
    return items.slice(0, 20);
}
