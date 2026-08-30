import type { ReactNode } from 'react';
import { Check, Database, Link2, Loader, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { INPUT_STYLE, SMALL_BUTTON_STYLE } from './notionImportStyles';
import type { NotionImportViewModel } from './useNotionImportSettings';


export function NotionClonePanel({
    viewModel,
}: {
    readonly viewModel: NotionImportViewModel;
}) {
    const { t } = useTranslation();
    const { actions, dialogs, state } = viewModel;
    if (!state.connected || state.databases.length === 0) return null;
    return (
        <>
            <div style={{
                alignItems: 'center',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 20,
                marginTop: 12,
            }}>
                {state.mcpConnected ? (
                    <span style={{
                        alignItems: 'center',
                        color: 'var(--gnosi-primary)',
                        display: 'flex',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                        gap: 6,
                    }}>
                        <Check size={14} />
                        {t('settings.notion.mcp_connected', { defaultValue: 'MCP connected' })}
                    </span>
                ) : (
                    <button
                        onClick={() => {
                            window.location.href = '/api/notion-oauth/login';
                        }}
                        style={SMALL_BUTTON_STYLE}
                        type="button"
                    >
                        <Link2 size={15} />
                        {t('settings.notion.mcp_connect_button', {
                            defaultValue: 'Connect MCP (required)',
                        })}
                    </button>
                )}
                {state.destClone && state.busy !== 'clone' ? (
                    <>
                        <span style={{ color: '#e0a52e', fontSize: '0.82rem', fontWeight: 700 }}>
                            ⚠️ {t('settings.notion.dest_has_clone', {
                                count: state.destClone.tables,
                                defaultValue: 'This vault already has a clone ({{count}} DB)',
                            })}
                        </span>
                        <ActionButton
                            busy={state.busy === 'verify'}
                            icon={<Check size={15} />}
                            label={t('settings.notion.verify_button', {
                                defaultValue: 'Verify the clone',
                            })}
                            onClick={() => void actions.runVerify()}
                        />
                        <button
                            disabled={state.busy === 'delclone'}
                            onClick={() => {
                                dialogs.setConfirmDeleteClone(true);
                            }}
                            style={{ ...SMALL_BUTTON_STYLE, borderColor: '#e0524e', color: '#e0524e' }}
                            type="button"
                        >
                            {state.busy === 'delclone'
                                ? <Loader className="animate-spin" size={15} />
                                : <X size={15} />}
                            {t('settings.notion.delete_clone_button', {
                                defaultValue: 'Delete the clone',
                            })}
                        </button>
                    </>
                ) : (
                    <>
                        <ActionButton
                            busy={state.busy === 'clone'}
                            disabled={state.selected.size === 0 || !state.mcpConnected}
                            icon={<Database size={15} />}
                            label={t('notion_clone', { defaultValue: 'Clone' })}
                            onClick={() => void actions.runClone()}
                        />
                        {state.busy === 'clone' ? <button
                            disabled={state.progress?.phase === 'cancelled'}
                            onClick={() => {
                                dialogs.setConfirmAbort(true);
                            }}
                            style={{ ...SMALL_BUTTON_STYLE, borderColor: '#e0524e', color: '#e0524e' }}
                            type="button"
                        >
                            <X size={15} />
                            {state.progress?.phase === 'cancelled'
                                ? t('settings.notion.aborting', { defaultValue: 'Aborting…' })
                                : t('settings.notion.abort_button', { defaultValue: 'Abort' })}
                        </button> : null}
                    </>
                )}
            </div>
            <CloneProgress viewModel={viewModel} />
        </>
    );
}


function ActionButton({
    busy,
    disabled = false,
    icon,
    label,
    onClick,
}: {
    readonly busy: boolean;
    readonly disabled?: boolean;
    readonly icon: ReactNode;
    readonly label: string;
    readonly onClick: () => void;
}) {
    return <button
        className="btn-gnosi-primary"
        disabled={busy || disabled}
        onClick={onClick}
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
        {busy ? <Loader className="animate-spin" size={15} /> : icon}
        {label}
    </button>;
}


function CloneProgress({ viewModel }: { readonly viewModel: NotionImportViewModel }) {
    const { t } = useTranslation();
    const { busy, progress } = viewModel.state;
    if (busy !== 'clone' || !progress) return null;
    const percentage = progress.total > 0
        ? Math.min(100, Math.round((progress.done / progress.total) * 100))
        : null;
    return <div style={{ marginTop: 14 }}>
        <style>{'@keyframes gnosi-indeterminate{0%{margin-left:-40%}100%{margin-left:100%}}'}</style>
        <div style={{
            color: 'var(--text-secondary)',
            display: 'flex',
            fontSize: '0.8rem',
            justifyContent: 'space-between',
            marginBottom: 6,
        }}>
            <span>{progress.phase}{progress.total > 0
                ? ` — ${String(progress.done)}/${String(progress.total)}`
                : ''}</span>
            <span>
                {progress.pages}/{progress.pages_total} {t('settings.notion.unit_pages', {
                    defaultValue: 'pages',
                })} · {progress.tables}/{progress.tables_total} DB · {progress.views} views
            </span>
        </div>
        <div style={{
            background: 'var(--bg-primary)',
            border: '1px solid var(--settings-border)',
            borderRadius: 99,
            height: 8,
            overflow: 'hidden',
        }}>
            <div style={{
                animation: percentage === null
                    ? 'gnosi-indeterminate 1.2s ease-in-out infinite'
                    : undefined,
                background: 'var(--gnosi-primary)',
                borderRadius: 99,
                height: '100%',
                transition: 'width 0.4s ease',
                width: percentage === null ? '40%' : `${String(percentage)}%`,
            }} />
        </div>
    </div>;
}
