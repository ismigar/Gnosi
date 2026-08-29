import { Check, Loader } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';

import { SMALL_BUTTON_STYLE } from './notionImportStyles';
import type { NotionImportViewModel } from './useNotionImportSettings';


export function NotionResultPanels({
    viewModel,
}: {
    readonly viewModel: NotionImportViewModel;
}) {
    return <>
        <CloneReport viewModel={viewModel} />
        <VerificationReport viewModel={viewModel} />
    </>;
}


function CloneReport({ viewModel }: { readonly viewModel: NotionImportViewModel }) {
    const { t } = useTranslation();
    const { actions, state } = viewModel;
    if (!state.report) return null;
    return <div style={{
        background: 'var(--bg-primary)',
        border: `1px solid ${state.report.status === 'cancelled'
            ? '#e0a52e'
            : 'var(--settings-border)'}`,
        borderRadius: 12,
        color: 'var(--text-primary)',
        fontSize: '0.85rem',
        marginTop: 18,
        padding: 14,
    }}>
        <div>
            {state.report.status === 'cancelled' ? '⏹️ ' : '✓ '}
            <b>{state.report.tables}</b> databases · <b>{state.report.pages}</b> pages ·{' '}
            <b>{state.report.views}</b> views · <b>{state.report.attachments}</b> attachments
        </div>
        {state.usedVaultName ? <div style={{ color: 'var(--text-secondary)', marginTop: 6 }}>
            📁 {t('settings.notion.used_vault_hint', {
                defaultValue: 'In the vault “{{name}}”. Switch to it to validate the clone.',
                name: state.usedVaultName,
            })}
        </div> : null}
        {state.report.truncated ? <div style={{ color: '#e0a52e', marginTop: 6 }}>
            ⚠️ {t('settings.notion.truncated_warning', {
                defaultValue: 'Page limit reached: the workspace is bigger.',
            })}
        </div> : null}
        {state.report.warnings.map((warning) => (
            <div key={warning} style={{ color: '#e0a52e' }}>⚠️ {warning}</div>
        ))}
        <button
            disabled={state.busy === 'verify'}
            onClick={() => void actions.runVerify()}
            style={{ ...SMALL_BUTTON_STYLE, marginTop: 10 }}
            type="button"
        >
            {state.busy === 'verify'
                ? <Loader className="animate-spin" size={14} />
                : <Check size={14} />}
            {t('settings.notion.verify_button', { defaultValue: 'Verify the clone' })}
        </button>
    </div>;
}


function VerificationReport({ viewModel }: { readonly viewModel: NotionImportViewModel }) {
    const { t } = useTranslation();
    const verification = viewModel.state.verify;
    if (!verification) return null;
    const tablesComplete = verification.summary.tables_ok === verification.summary.tables_total;
    const healthy = verification.summary.healthy || tablesComplete;
    const mismatches = verification.tables.filter(({ ok }) => !ok);
    return <div style={{
        background: 'var(--bg-primary)',
        border: `1px solid ${healthy ? 'var(--gnosi-primary)' : '#e0a52e'}`,
        borderRadius: 12,
        color: 'var(--text-primary)',
        fontSize: '0.85rem',
        marginTop: 14,
        padding: 14,
    }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>
            {verification.summary.healthy
                ? t('settings.notion.verify_healthy', { defaultValue: '✅ Healthy clone' })
                : tablesComplete
                    ? t('settings.notion.verify_complete_minor', {
                        defaultValue: '✅ Complete clone (minor details)',
                    })
                    : t('settings.notion.verify_incomplete', {
                        defaultValue: '⚠️ Incomplete clone: pages are missing',
                    })}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 8 }}>
            <span>DBs: <b>{verification.summary.tables_ok}/{verification.summary.tables_total}</b></span>
            <span>Pages: <b>{verification.summary.pages}</b></span>
            <span>Views: <b>{verification.summary.views}</b></span>
            <span>Empty: <b>{verification.summary.empty_bodies}</b></span>
            <span>Orphans: <b>{verification.summary.orphan_relations}</b></span>
            <span>Missing assets: <b>{verification.summary.missing_assets}</b></span>
        </div>
        {tablesComplete && !verification.summary.healthy ? <Trans
            components={{ b: <b /> }}
            i18nKey="settings.notion.verify_minor_details_note"
        /> : null}
        {mismatches.map((row) => <div key={row.table_id} style={{ color: '#e0a52e' }}>
            ⚠️ Notion: {row.notion}; clone: {row.clone}; missing: {row.missing}
        </div>)}
    </div>;
}
