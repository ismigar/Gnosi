import { Check, Link2, Loader, Unlink } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';

import { INPUT_STYLE, SMALL_BUTTON_STYLE } from './notionImportStyles';
import type { NotionImportViewModel } from './useNotionImportSettings';


export function NotionConnectionPanel({
    viewModel,
}: {
    readonly viewModel: NotionImportViewModel;
}) {
    const { t } = useTranslation();
    const { actions, setters, state } = viewModel;
    if (state.connected === null) {
        return <div style={{ color: 'var(--text-tertiary)', padding: 8 }}>
            {t('common.loading', { defaultValue: 'Loading...' })}
        </div>;
    }
    if (!state.connected) {
        return (
            <div style={{ marginTop: 14 }}>
                <label style={{
                    color: 'var(--text-secondary)',
                    display: 'block',
                    fontSize: '0.82rem',
                    marginBottom: 6,
                }}>
                    {t('settings.notion.token_label', {
                        defaultValue: 'Internal integration token (notion.so/my-integrations → share the databases with the integration)',
                    })}
                </label>
                <div style={{ display: 'flex', gap: 10 }}>
                    <input
                        onChange={(event) => {
                            setters.setToken(event.target.value);
                        }}
                        placeholder={t('settings.notion.token_placeholder', {
                            defaultValue: 'ntn_… or secret_…',
                        })}
                        style={{ ...INPUT_STYLE, flex: 1 }}
                        type="password"
                        value={state.token}
                    />
                    <button
                        className="btn-gnosi-primary"
                        disabled={state.busy === 'token' || !state.token.trim()}
                        onClick={() => void actions.connect()}
                        style={{
                            alignItems: 'center',
                            borderRadius: 12,
                            display: 'flex',
                            fontSize: '0.85rem',
                            gap: 8,
                            padding: '9px 18px',
                        }}
                        type="button"
                    >
                        <Link2 size={15} />
                        {state.busy === 'token'
                            ? t('settings.notion.validating', { defaultValue: 'Validating…' })
                            : t('settings.notion.connect_button', { defaultValue: 'Connect' })}
                    </button>
                </div>
            </div>
        );
    }
    return (
        <>
            <div style={{
                alignItems: 'center',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 12,
                marginTop: 14,
            }}>
                <span style={{
                    alignItems: 'center',
                    color: 'var(--gnosi-primary)',
                    display: 'inline-flex',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    gap: 6,
                }}>
                    <Check size={16} />
                    {t('settings.notion.connected_label', { defaultValue: 'Connected' })}
                    {state.name ? ` · ${state.name}` : ''}
                </span>
                <button
                    disabled={state.busy === 'token'}
                    onClick={() => void actions.disconnect()}
                    style={SMALL_BUTTON_STYLE}
                    type="button"
                >
                    <Unlink size={14} />
                    {t('settings.notion.disconnect_button', { defaultValue: 'Disconnect' })}
                </button>
                <button
                    className="btn-gnosi-primary"
                    disabled={state.busy === 'list'}
                    onClick={() => void actions.listDatabases()}
                    style={{ borderRadius: 10, fontSize: '0.82rem', padding: '7px 14px' }}
                    type="button"
                >
                    {state.busy === 'list'
                        ? t('common.loading', { defaultValue: 'Loading...' })
                        : t('settings.notion.list_databases_button', {
                            defaultValue: 'List databases',
                        })}
                </button>
                <button
                    disabled={state.busy === 'linked'}
                    onClick={() => void actions.checkLinked()}
                    style={SMALL_BUTTON_STYLE}
                    type="button"
                >
                    {state.busy === 'linked'
                        ? <Loader className="animate-spin" size={14} />
                        : <Unlink size={14} />}
                    {state.busy === 'linked'
                        ? t('settings.notion.searching', { defaultValue: 'Searching…' })
                        : t('settings.notion.detect_linked_button', {
                            defaultValue: 'Detect linked views',
                        })}
                </button>
            </div>
            <LinkedDatabaseNotice viewModel={viewModel} />
        </>
    );
}


function LinkedDatabaseNotice({ viewModel }: { readonly viewModel: NotionImportViewModel }) {
    const { t } = useTranslation();
    const linked = viewModel.state.linkedDbs;
    if (!linked) return null;
    if (linked.linked.length === 0) {
        return <div style={{ ...INPUT_STYLE, marginTop: 12 }}>
            {linked.capped
                ? t('settings.notion.no_linked_found_partial', {
                    defaultValue: '✓ No non-importable linked views detected (partial scan).',
                })
                : t('settings.notion.no_linked_found', {
                    defaultValue: '✓ No non-importable linked views detected.',
                })}
        </div>;
    }
    return (
        <div style={{ ...INPUT_STYLE, borderColor: '#e0a52e', marginTop: 12 }}>
            <div style={{ color: '#e0a52e', fontWeight: 800, marginBottom: 6 }}>
                ⚠️ {t('settings.notion.linked_db_count', {
                    count: linked.linked.length,
                    defaultValue: '{{count}} linked DB (not importable)',
                })}
            </div>
            <Trans
                components={{ b: <b /> }}
                i18nKey="settings.notion.linked_views_explanation"
            />
            {linked.linked.map((item, index) => (
                <div key={`${item.page_title}-${String(index)}`} style={{ padding: '3px 0' }}>
                    🔗 <b>{item.title || 'Untitled'}</b> — {item.page_title}
                </div>
            ))}
        </div>
    );
}
