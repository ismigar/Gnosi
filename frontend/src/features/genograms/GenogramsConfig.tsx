import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchGenogramSetupStatus, genogramRequestContext, prepareGenograms } from '../../shared/api/genograms';
import { useVaultCatalog } from '../../shared/api/useVaultCatalog';
import { emitAppEvent } from '../../shared/platform/app-events';
import { usePlugins } from '../../shared/plugins/usePlugins';
import { errorMessage } from './errors';
import './genograms-config.css';

function VaultSetup({ vaultId, vaultName, workspaceId }: { vaultId: string; vaultName: string; workspaceId: string }) {
  const { t, i18n } = useTranslation();
  const { isEnabled } = usePlugins();
  const queryClient = useQueryClient();
  const queryKey = ['genograms-setup', workspaceId, vaultId];
  const status = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchGenogramSetupStatus(vaultId, signal),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchInterval: 15_000,
  });
  const prepare = useMutation({
    mutationFn: () => {
      const language = (i18n.resolvedLanguage ?? i18n.language).split('-')[0];
      return prepareGenograms(language === 'ca' || language === 'es' || language === 'fr' ? language : 'en', vaultId);
    },
    onMutate: () => queryClient.cancelQueries({ queryKey }),
    onSuccess: () => {
      queryClient.setQueryData(queryKey, { ready: true });
      void queryClient.invalidateQueries({ queryKey });
      const current = genogramRequestContext();
      if (current.vaultId === vaultId && current.workspaceId === workspaceId) {
        emitAppEvent('gnosi:genograms-prepared');
        emitAppEvent('gnosi:genograms-changed');
      }
    },
  });

  if (status.isPending) return <p role="status">{t('genograms.checking_tables')}</p>;
  if (status.isError) return <>
    <p role="alert">{t('genograms.status_error')}</p>
    <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={() => { void status.refetch(); }}>{t('common.retry')}</button>
  </>;
  if (status.data.ready) return <p role="status" className="genograms-config__ready">
    <CheckCircle2 size={18} aria-hidden="true" />
    <span>{t('genograms.tables_ready', { vault: vaultName })}</span>
  </p>;
  return <>
    <button type="button" className="btn-gnosi btn-gnosi-primary" disabled={prepare.isPending || !isEnabled('genograms')} onClick={() => { prepare.mutate(); }}>
      {t(prepare.isPending ? 'common.loading' : 'genograms.prepare')}
    </button>
    {prepare.isError && <p role="alert">{errorMessage(prepare.error, t)}</p>}
  </>;
}

export default function GenogramsConfig() {
  const { t, i18n } = useTranslation();
  const catalog = useVaultCatalog();
  const requestContext = genogramRequestContext();
  const [selectedId, setSelectedId] = useState(requestContext.vaultId);
  const selectId = useId();
  const vaults = [...(catalog.data?.vaults ?? [])].sort((a, b) => a.name.localeCompare(b.name, i18n.resolvedLanguage ?? i18n.language));
  const selected = vaults.find(vault => vault.id === selectedId) ?? vaults.find(vault => vault.active) ?? vaults[0];

  return <div className="genograms-config">
    <p>{t('genograms.setup_description')}</p>
    {catalog.isPending ? <p role="status">{t('common.loading')}</p> : catalog.isError ? <>
      <p role="alert">{t('genograms.vaults_error')}</p>
      <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={() => { void catalog.refetch(); }}>{t('common.retry')}</button>
    </> : !selected ? <p role="status">{t('genograms.no_vaults')}</p> : <>
      <label htmlFor={selectId}>{t('genograms.target_vault')}</label>
      <select id={selectId} value={selected.id} onChange={event => { setSelectedId(event.target.value); }}>
        {vaults.map(vault => <option key={vault.id} value={vault.id}>{vault.name}</option>)}
      </select>
      <VaultSetup key={`${requestContext.workspaceId}:${selected.id}`} vaultId={selected.id} vaultName={selected.name} workspaceId={requestContext.workspaceId} />
    </>}
  </div>;
}
