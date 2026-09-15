import { useRef, useState } from 'react';
import { BookmarkPlus, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ReaderArticle } from '../../../shared/api/reader';
import { importLiteratureWorks } from '../../../shared/api/literature';
import { fetchReferenceTable } from '../../../shared/api/literature-resources';
import { logError } from '../../../shared/notifications/notifyError';
import { toast } from '../../../shared/notifications/toast';
import { usePlugins } from '../../../shared/plugins/usePlugins';

interface ReaderResourceButtonProps {
    readonly article: ReaderArticle;
    readonly body: string;
    readonly disabled: boolean;
}

export function ReaderResourceButton({ article, body, disabled }: ReaderResourceButtonProps) {
    const { t } = useTranslation();
    const { isEnabled } = usePlugins();
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const savingRef = useRef(false);
    if (!isEnabled('resources')) return null;

    const save = async (): Promise<void> => {
        if (savingRef.current || saved || disabled) return;
        savingRef.current = true;
        setSaving(true);
        try {
            const table = await fetchReferenceTable();
            if (!table.configured || !table.table_id) {
                toast.error(t('reader_resources_configure'));
                return;
            }
            const text = body.includes('<')
                ? new DOMParser().parseFromString(body, 'text/html').body.textContent
                : body;
            await importLiteratureWorks([{
                id: `reader:${String(article.id)}`,
                type: 'newspaper-article',
                title: article.title,
                abstract: text,
                dates: { issued: article.published_at ?? '' },
                publication: { container_title: article.source_name ?? '' },
                locations: [{ landing_page_url: article.url }],
                sources: [{ provider: 'reader', provider_id: String(article.id), url: article.url }],
            }]);
            setSaved(true);
            toast.success(t('reader_resources_saved'));
        } catch (error: unknown) {
            logError('reader-save-resource', error);
            toast.error(t('reader_resources_error'));
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    return <button
        onClick={() => { void save(); }}
        disabled={disabled || saving || saved}
        className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
        type="button"
    >
        {saved ? <Check size={15} /> : <BookmarkPlus size={15} />}
        <span>{t(saved ? 'reader_resources_saved' : saving ? 'reader_resources_saving' : 'reader_add_to_resources')}</span>
    </button>;
}
