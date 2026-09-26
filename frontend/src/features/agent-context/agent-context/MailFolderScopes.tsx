import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchMailFolders } from '../../../shared/api/mail';
import { RefreshButton } from '../../../shared/ui/actions/RefreshButton';
import { asContextScope, contextString, contextStringArray, type ContextScope } from './agentContextModel';
import { ScopeMultiSelect } from './ScopeMultiSelect';
import { useContextResource } from './useContextResource';

function AccountFolders({ account, scope, onPatch }: {
    readonly account: string;
    readonly scope: ContextScope | undefined;
    readonly onPatch: (patch: ContextScope) => void;
}) {
    const { t } = useTranslation();
    const [revision, setRevision] = useState(0);
    const load = useCallback((signal: AbortSignal) => fetchMailFolders(account, signal), [account]);
    const resource = useContextResource(load, true, revision);
    const folders = asContextScope(scope?.folders_by_account);
    const configured = contextStringArray(folders, account);
    const values = configured.length ? configured : [contextString(scope, 'folder', 'INBOX')];
    return <div className="agent-source-folders">
        <div className="agent-source-heading"><strong>{account}</strong>
            <RefreshButton loading={resource.loading} onClick={() => { setRevision(value => value + 1); }} />
        </div>
        {resource.error ? <p role="alert">{t('settings.ai.sources.load_error', 'Could not load options. Try again.')}</p> : null}
        {resource.loading ? <p role="status">{t('common.loading', 'Loading...')}</p> : null}
        <ScopeMultiSelect label={t('settings.ai.sources.mail_folders', 'Folders')}
            options={(resource.data?.folders ?? []).map(folder => ({ id: folder.name, name: folder.name }))}
            values={values} minimum={1} disabled={resource.loading || resource.error}
            onChange={next => { onPatch({ folders_by_account: { ...folders, [account]: next } }); }} />
        <small>{t('settings.ai.sources.mail_minimum', 'Choose at least one folder per account. New accounts use the default folder.')}</small>
    </div>;
}

export function MailFolderScopes({ scope, options, onPatch }: {
    readonly scope: ContextScope | undefined;
    readonly options: ContextScope;
    readonly onPatch: (patch: ContextScope) => void;
}) {
    const configured = contextStringArray(options, 'accounts');
    const selected = contextStringArray(scope, 'accounts');
    const accounts = selected.length ? selected.filter(account => configured.includes(account)) : configured;
    const { t } = useTranslation();
    return <div className="agent-source-grid">
        {accounts.map(account => <AccountFolders key={account} account={account} scope={scope} onPatch={onPatch} />)}
        {accounts.length === 0 ? <p>{t('settings.ai.sources.no_accounts', 'No connected accounts available.')}</p> : null}
    </div>;
}
