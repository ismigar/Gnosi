import { Loader, RotateCw, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { INPUT_STYLE, MUTED_TEXT_STYLE } from './notionImportStyles';
import type { LoosePageKind } from './notionImportModel';
import type { NotionImportViewModel } from './useNotionImportSettings';


export function NotionDatabasePanel({
    viewModel,
}: {
    readonly viewModel: NotionImportViewModel;
}) {
    const { t } = useTranslation();
    const { actions, setters, state } = viewModel;
    if (!state.connected || state.databases.length === 0) return null;
    const allSelected = state.selected.size === state.databases.length;
    return (
        <div style={{ marginTop: 18 }}>
            <div style={{
                alignItems: 'center',
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: 8,
            }}>
                <div style={{ ...MUTED_TEXT_STYLE, fontWeight: 700 }}>
                    {t('settings.notion.databases_header', {
                        defaultValue: 'Databases — check which ones to include ({{selected}}/{{total}})',
                        selected: state.selected.size,
                        total: state.databases.length,
                    })}
                </div>
                <SelectionButton
                    allSelected={allSelected}
                    onClick={() => {
                        setters.setSelected(allSelected
                            ? new Set()
                            : new Set(state.databases.map(({ id }) => id)));
                    }}
                />
            </div>
            <div style={{
                display: 'grid',
                gap: 8,
                gridTemplateColumns: '1fr 1fr',
                maxHeight: 220,
                overflow: 'auto',
            }}>
                {state.databases.map((database) => (
                    <div key={database.id} style={{
                        alignItems: 'center',
                        border: '1px solid var(--settings-border)',
                        borderRadius: 10,
                        display: 'flex',
                        gap: 8,
                        minWidth: 0,
                        padding: '6px 10px',
                    }}>
                        <label style={{
                            alignItems: 'center',
                            cursor: 'pointer',
                            display: 'flex',
                            flex: 1,
                            gap: 8,
                            minWidth: 0,
                        }}>
                            <input
                                checked={state.selected.has(database.id)}
                                onChange={() => {
                                    setters.setSelected((current) => {
                                        const next = new Set(current);
                                        if (next.has(database.id)) next.delete(database.id);
                                        else next.add(database.id);
                                        return next;
                                    });
                                }}
                                type="checkbox"
                            />
                            <span style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}>
                                {database.title}
                            </span>
                        </label>
                        <button
                            disabled={state.busy === `schema:${database.id}`}
                            onClick={() => void actions.openSchema(database)}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: state.schemaOverrides[database.id]
                                    ? 'var(--gnosi-primary)'
                                    : 'var(--text-tertiary)',
                                cursor: 'pointer',
                                display: 'flex',
                            }}
                            type="button"
                        >
                            {state.busy === `schema:${database.id}`
                                ? <Loader className="animate-spin" size={14} />
                                : <Settings size={14} />}
                        </button>
                    </div>
                ))}
            </div>
            <label style={{
                ...MUTED_TEXT_STYLE,
                alignItems: 'center',
                cursor: 'pointer',
                display: 'flex',
                gap: 10,
                marginTop: 16,
            }}>
                <div
                    className={`gnosi-toggle ${state.loosePages ? 'active' : ''}`}
                    onClick={() => {
                        setters.setLoosePages((current) => !current);
                    }}
                >
                    <div className="gnosi-toggle-handle" />
                </div>
                {t('settings.notion.loose_pages_toggle_label', {
                    defaultValue: 'Include loose pages (not in any DB)',
                })}
                {state.busy === 'loose' ? <Loader className="animate-spin" size={13} /> : null}
            </label>
            <LoosePagesPanel viewModel={viewModel} />
            <DestinationVaultPanel viewModel={viewModel} />
        </div>
    );
}


function SelectionButton({
    allSelected,
    onClick,
}: {
    readonly allSelected: boolean;
    readonly onClick: () => void;
}) {
    const { t } = useTranslation();
    return <button
        onClick={onClick}
        style={{
            background: 'none',
            border: 'none',
            color: 'var(--gnosi-primary)',
            cursor: 'pointer',
            fontSize: '0.78rem',
        }}
        type="button"
    >
        {allSelected
            ? t('settings.notion.select_none', { defaultValue: 'None' })
            : t('settings.notion.select_all', { defaultValue: 'All' })}
    </button>;
}


function LoosePagesPanel({ viewModel }: { readonly viewModel: NotionImportViewModel }) {
    const { t } = useTranslation();
    const { actions, setters, state } = viewModel;
    if (!state.loosePages || state.loosePagesList.length === 0) return null;
    const allSelected = state.looseSelected.size === state.loosePagesList.length;
    return (
        <div style={{ marginTop: 12 }}>
            <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}>
                <div style={{ ...MUTED_TEXT_STYLE, fontWeight: 700 }}>
                    {t('settings.notion.loose_pages_header', {
                        defaultValue: 'Pages outside a DB — check which ones to include ({{selected}}/{{total}})',
                        selected: state.looseSelected.size,
                        total: state.loosePagesList.length,
                    })}
                </div>
                <div style={{ alignItems: 'center', display: 'flex', gap: 10 }}>
                    <button
                        disabled={state.busy === 'loose'}
                        onClick={() => void actions.fetchLoose()}
                        style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                        type="button"
                    >
                        <RotateCw
                            className={state.busy === 'loose' ? 'animate-spin' : undefined}
                            size={13}
                        />
                    </button>
                    <SelectionButton
                        allSelected={allSelected}
                        onClick={() => {
                            setters.setLooseSelected(allSelected
                                ? new Set()
                                : new Set(state.loosePagesList.map(({ id }) => id)));
                        }}
                    />
                </div>
            </div>
            <div style={{ display: 'grid', gap: 6, marginTop: 8, maxHeight: 200, overflow: 'auto' }}>
                {state.loosePagesList.map((page) => (
                    <LoosePageRow key={page.id} pageId={page.id} title={page.title} viewModel={viewModel} />
                ))}
            </div>
        </div>
    );
}


function LoosePageRow({
    pageId,
    title,
    viewModel,
}: {
    readonly pageId: string;
    readonly title: string;
    readonly viewModel: NotionImportViewModel;
}) {
    const { setters, state } = viewModel;
    const included = state.looseSelected.has(pageId);
    const chooseKind = (kind: LoosePageKind): void => {
        setters.setLoosePageTypes((current) => ({ ...current, [pageId]: kind }));
        setters.setLooseSelected((current) => new Set(current).add(pageId));
    };
    return <div style={{
        alignItems: 'center',
        border: '1px solid var(--settings-border)',
        borderRadius: 10,
        display: 'flex',
        gap: 10,
        opacity: included ? 1 : 0.5,
        padding: '6px 10px',
    }}>
        <label style={{ cursor: 'pointer', display: 'flex', flex: 1, gap: 8 }}>
            <input
                checked={included}
                onChange={() => {
                    setters.setLooseSelected((current) => {
                        const next = new Set(current);
                        if (next.has(pageId)) next.delete(pageId); else next.add(pageId);
                        return next;
                    });
                }}
                type="checkbox"
            />
            <span>{title}</span>
        </label>
        {(['wiki', 'dashboard'] as const).map((kind) => (
            <button
                key={kind}
                onClick={() => {
                    chooseKind(kind);
                }}
                style={{
                    background: included && (state.loosePageTypes[pageId] ?? 'wiki') === kind
                        ? 'var(--gnosi-primary)'
                        : 'transparent',
                    border: 'none',
                    color: included ? 'var(--text-primary)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: '4px 8px',
                }}
                type="button"
            >
                {kind === 'wiki' ? 'Wiki' : 'Dashboard'}
            </button>
        ))}
    </div>;
}


function DestinationVaultPanel({ viewModel }: { readonly viewModel: NotionImportViewModel }) {
    const { t } = useTranslation();
    const { setters, state } = viewModel;
    return <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
        <label style={MUTED_TEXT_STYLE}>
            {t('settings.notion.dest_vault_label', { defaultValue: 'Destination vault:' })}&nbsp;
            <select
                onChange={(event) => {
                    setters.setCloneVaultId(event.target.value);
                }}
                style={INPUT_STYLE}
                value={state.cloneVaultId}
            >
                <option value="__new__">
                    ➕ {t('settings.notion.new_vault_option', {
                        defaultValue: 'Create a new vault (at the root)',
                    })}
                </option>
                {state.vaults.map((vault) => (
                    <option key={vault.id} value={vault.id}>
                        {vault.name}{vault.active ? ' (active)' : ''}
                    </option>
                ))}
            </select>
        </label>
        {state.cloneVaultId === '__new__' ? <input
            onChange={(event) => {
                setters.setNewVaultName(event.target.value);
            }}
            placeholder="Notion"
            style={{ ...INPUT_STYLE, width: 160 }}
            value={state.newVaultName}
        /> : null}
    </div>;
}
