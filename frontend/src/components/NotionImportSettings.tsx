import type { ComponentType } from 'react';
import { Database } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ConfirmModal as LegacyConfirmModal } from './ConfirmModal';
import { NotionClonePanel } from './notion-import/NotionClonePanel';
import { NotionConnectionPanel } from './notion-import/NotionConnectionPanel';
import { NotionDatabasePanel } from './notion-import/NotionDatabasePanel';
import { NotionResultPanels } from './notion-import/NotionResultPanels';
import { CARD_STYLE } from './notion-import/notionImportStyles';
import type { NotionSchema } from './notion-import/notionImportModel';
import {
    useNotionImportSettings,
    type NotionImportViewModel,
} from './notion-import/useNotionImportSettings';
import { SchemaConfigModal as LegacySchemaConfigModal } from './Vault/SchemaConfigModal';


interface ConfirmModalProps {
    readonly cancelText: string;
    readonly confirmText: string;
    readonly isDestructive: boolean;
    readonly isOpen: boolean;
    readonly message: string;
    readonly onClose: () => void;
    readonly onConfirm: () => void | Promise<void>;
    readonly title: string;
}


interface SchemaConfigModalProps {
    readonly availableTables: readonly { readonly id: string; readonly name: string }[];
    readonly currentSchema: NotionSchema;
    readonly folder: string;
    readonly isOpen: boolean;
    readonly onClose: () => void;
    readonly onSave: (schema: NotionSchema) => void;
    readonly onSchemaUpdated: (schema: NotionSchema) => void;
    readonly tableName: string;
}


const ConfirmModal = LegacyConfirmModal as ComponentType<ConfirmModalProps>;
const SchemaConfigModal = LegacySchemaConfigModal as unknown as ComponentType<
    SchemaConfigModalProps
>;


export default function NotionImportSettings() {
    const { t } = useTranslation();
    const viewModel = useNotionImportSettings();
    return (
        <div style={CARD_STYLE}>
            <header style={{ alignItems: 'center', display: 'flex', gap: 12, marginBottom: 8 }}>
                <Database size={20} />
                <div>
                    <div style={{
                        color: 'var(--text-primary)',
                        fontSize: '1.05rem',
                        fontWeight: 900,
                    }}>
                        {t('settings.notion.title', { defaultValue: 'Clone from Notion' })}
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                        {t('settings.notion.subtitle', {
                            defaultValue: 'Exact clone: databases, pages, relations, embedded views, colors, columns, attachments and covers.',
                        })}
                    </div>
                </div>
            </header>
            <NotionConnectionPanel viewModel={viewModel} />
            <NotionDatabasePanel viewModel={viewModel} />
            <NotionClonePanel viewModel={viewModel} />
            <NotionResultPanels viewModel={viewModel} />
            {viewModel.state.error ? <div style={{
                color: '#e05252',
                fontSize: '0.82rem',
                marginTop: 14,
            }}>
                {viewModel.state.error}
            </div> : null}
            <NotionDialogs viewModel={viewModel} />
        </div>
    );
}


function NotionDialogs({ viewModel }: { readonly viewModel: NotionImportViewModel }) {
    const { t } = useTranslation();
    const { actions, dialogs, setters, state } = viewModel;
    const configuration = dialogs.schemaConfiguration;
    const saveSchema = (schema: NotionSchema): void => {
        if (!configuration) return;
        setters.setSchemaOverrides((current) => ({
            ...current,
            [configuration.database.id]: schema,
        }));
    };
    return <>
        {configuration ? <SchemaConfigModal
            availableTables={state.databases.map((database) => ({
                id: database.id.replaceAll('-', ''),
                name: database.title,
            }))}
            currentSchema={configuration.schema}
            folder={configuration.database.title || 'Notion'}
            isOpen
            onClose={() => {
                dialogs.setSchemaConfiguration(null);
            }}
            onSave={saveSchema}
            onSchemaUpdated={saveSchema}
            tableName={configuration.database.title}
        /> : null}
        <ConfirmModal
            cancelText={t('settings.notion.confirm_abort_cancel', {
                defaultValue: 'Keep cloning',
            })}
            confirmText={t('settings.notion.confirm_abort_confirm', {
                defaultValue: 'Abort the clone',
            })}
            isDestructive
            isOpen={dialogs.confirmAbort}
            message={t('settings.notion.confirm_abort_message', {
                defaultValue: 'The clone will stop at the next checkpoint. Partial data will stay on disk.',
            })}
            onClose={() => {
                dialogs.setConfirmAbort(false);
            }}
            onConfirm={actions.abortClone}
            title={t('settings.notion.confirm_abort_title', {
                defaultValue: 'Abort the clone?',
            })}
        />
        <ConfirmModal
            cancelText={t('settings.notion.confirm_delete_clone_cancel', {
                defaultValue: 'Cancel',
            })}
            confirmText={t('settings.notion.delete_clone_button', {
                defaultValue: 'Delete the clone',
            })}
            isDestructive
            isOpen={dialogs.confirmDeleteClone}
            message={t('settings.notion.confirm_delete_clone_message', {
                defaultValue: 'The entire vault “{{name}}” will be deleted. This action cannot be undone.',
                name: state.vaults.find(({ id }) => id === state.cloneVaultId)?.name ?? '',
            })}
            onClose={() => {
                dialogs.setConfirmDeleteClone(false);
            }}
            onConfirm={actions.deleteClone}
            title={t('settings.notion.confirm_delete_clone_title', {
                defaultValue: 'Delete the clone?',
            })}
        />
    </>;
}
