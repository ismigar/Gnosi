import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useRequestContext } from '../../../shared/hooks/useRequestContext';
import { vaultPath } from '../../../shared/routing/vaultRouting';
import { RefreshButton } from '../../../shared/ui/actions/RefreshButton';
import type { HomeBlockProps } from '../model';
import { BoardBlock } from './BoardBlock';
import { GraphBlock } from './GraphBlock';
import { KnowledgeStatus } from './KnowledgeFields';
import { useKnowledgeCatalog } from './knowledgeQueries';
import './knowledge.css';

export default function KnowledgeBlocks(props: HomeBlockProps) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const scope = useRequestContext();
  const pages = useKnowledgeCatalog(scope);
  if (pages.isError) return <KnowledgeStatus state="failed" retry={() => { void pages.refetch(); }} />;
  if (!pages.data) return <KnowledgeStatus state="loading" />;
  const catalog = pages.data;
  const Block = props.block.kind === 'board' ? BoardBlock : GraphBlock;
  const refreshCatalog = async () => {
    const next = await pages.refetch();
    if (props.block.kind === 'board' && next.isSuccess && !next.data.complete) {
      await client.invalidateQueries({ queryKey: ['home-knowledge', scope, 'view', false] });
    }
  };
  return <>
    {!catalog.complete && <div className="home-knowledge-index-status">
      <p className="home-knowledge-status" role="status">{t('home_canvas.knowledge.catalogPending')} <Link className="home-knowledge-source" to={vaultPath('knowledge')}>{t('home_canvas.knowledge.openKnowledge')}</Link></p>
      <RefreshButton loading={pages.isFetching} onClick={() => { void refreshCatalog(); }} />
    </div>}
    <Block {...props} scope={scope} pages={catalog.pages} catalogComplete={catalog.complete} />
  </>;
}
