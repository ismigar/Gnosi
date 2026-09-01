import type {
    LiteratureConfiguration,
    LiteratureSource,
    ReferenceTableStatus,
} from '../../../../shared/api/literature-resources';
import type { RepositoryDraft } from './resourcesPluginConfigModel';

export interface CredentialFeedback {
    readonly isError: boolean;
    readonly key: string;
    readonly message: string;
}

export interface ResourcesTableOption {
    readonly id: string;
    readonly name: string;
}

export interface ResourcesPluginConfigController {
    readonly busy: string;
    readonly cancelSynchronization: (source: LiteratureSource) => void;
    readonly closeDeleteConfirmation: () => void;
    readonly closeRepositoryForm: () => void;
    readonly confirmDelete: () => void;
    readonly configuration: LiteratureConfiguration;
    readonly contactEmailInput: string;
    readonly credentialFeedback: CredentialFeedback;
    readonly credentialsInputs: Readonly<Record<string, string>>;
    readonly credentialsStatus: Readonly<Record<string, boolean>>;
    readonly credentialsVisible: Readonly<Record<string, boolean>>;
    readonly createReference: () => void;
    readonly deleteCredential: (serviceKey: string, serviceName: string) => void;
    readonly deleteIndex: boolean;
    readonly deleteTarget: LiteratureSource | null;
    readonly editRepository: (source: LiteratureSource) => void;
    readonly error: string;
    readonly focusCredentialForSource: (source: LiteratureSource) => void;
    readonly hiddenSourceCount: number;
    readonly highlightCredentialKey: string;
    readonly loading: boolean;
    readonly notice: string;
    readonly openNewRepository: () => void;
    readonly referenceTable: ReferenceTableStatus;
    readonly repository: RepositoryDraft;
    readonly repositoryStaticFilters: string;
    readonly requestDelete: (source: LiteratureSource) => void;
    readonly restoreHiddenSources: () => void;
    readonly resumeSynchronization: (source: LiteratureSource) => void;
    readonly saveCredential: (
        serviceKey: string,
        serviceName: string,
        customValue?: string,
    ) => void;
    readonly saveRepository: () => void;
    readonly savingCredentialKey: string;
    readonly selectReferenceTable: (tableId: string) => void;
    readonly setContactEmailInput: (value: string) => void;
    readonly setDeleteIndex: (value: boolean) => void;
    readonly setRepositoryField: <Key extends keyof RepositoryDraft>(
        key: Key,
        value: RepositoryDraft[Key],
    ) => void;
    readonly setRepositoryMapping: (field: string, value: string) => void;
    readonly setRepositoryStaticFilters: (value: string) => void;
    readonly showCredentialsInline: boolean;
    readonly showRepositoryForm: boolean;
    readonly synchronize: (source: LiteratureSource, full?: boolean) => void;
    readonly tables: readonly ResourcesTableOption[];
    readonly testRepository: () => void;
    readonly toggleCredentialVisibility: (serviceKey: string) => void;
    readonly toggleCredentials: () => void;
    readonly toggleHidden: (source: LiteratureSource, hidden: boolean) => void;
    readonly toggleSource: (source: LiteratureSource, enabled: boolean) => void;
    readonly updateCredentialInput: (serviceKey: string, value: string) => void;
    readonly visibleSources: readonly LiteratureSource[];
    readonly commitContactEmail: () => void;
    readonly markContactEmailEditing: () => void;
}
