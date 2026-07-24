import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { Loader2, Lock, FileText } from 'lucide-react';
import { VaultMarkdown } from '../components/Vault/VaultMarkdown';

/**
 * Public read-only view of a shared page (`/s/:token`). Renders OUTSIDE the
 * auth gate and app shell — anyone with the link can open it. Content is
 * fetched from the anonymous `GET /api/share/:token` endpoint.
 */
export default function SharedPage() {
    const { t } = useTranslation();
    const { token } = useParams();
    const [state, setState] = useState({ loading: true, error: null, data: null });

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await axios.get(`/api/share/${token}`);
                if (!cancelled) setState({ loading: false, error: null, data: res.data });
            } catch (err) {
                if (!cancelled) {
                    const status = err?.response?.status;
                    setState({
                        loading: false,
                        error: status === 404 ? 'not_found' : 'error',
                        data: null,
                    });
                }
            }
        })();
        return () => { cancelled = true; };
    }, [token]);

    if (state.loading) {
        return (
            <div className="flex h-screen items-center justify-center bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
                <Loader2 size={20} className="animate-spin mr-2" /> {t('common.loading', "Loading...")}
            </div>
        );
    }

    if (state.error) {
        return (
            <div className="flex h-screen flex-col items-center justify-center bg-[var(--bg-secondary)] text-[var(--text-tertiary)] gap-3">
                <Lock size={40} className="opacity-40" />
                <p className="text-sm">
                    {state.error === 'not_found'
                        ? t('shared_page.link_invalid', "This link is invalid or has expired.")
                        : t('shared_page.load_error', "The shared page could not be loaded.")}
                </p>
            </div>
        );
    }

    const page = state.data?.page || {};
    return (
        <div className="min-h-screen bg-[var(--bg-secondary)] py-10 px-4">
            <div className="max-w-3xl mx-auto bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-2xl shadow-sm p-8">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-4">
                    <FileText size={12} />
                    <span>{t('shared_page.readonly_badge', "Shared · read only")}</span>
                </div>
                <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-6">
                    {page.title || t('common.untitled', "Untitled")}
                </h1>
                <div className="prose prose-sm max-w-none text-[var(--text-primary)]">
                    <VaultMarkdown md={page.content || ''} vaultId={page.vault_id} />
                </div>
            </div>
            <p className="text-center text-[10px] text-[var(--text-tertiary)] mt-6">{t('app_title', 'Gnosi')}</p>
        </div>
    );
}
