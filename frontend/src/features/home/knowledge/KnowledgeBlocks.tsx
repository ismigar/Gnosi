import { useRequestContext } from '../../../shared/hooks/useRequestContext';
import type { HomeBlockProps } from '../model';
import { BoardBlock } from './BoardBlock';
import { GraphBlock } from './GraphBlock';
import { KnowledgeStatus } from './KnowledgeFields';
import { useKnowledgeCatalog } from './knowledgeQueries';
import './knowledge.css';

export default function KnowledgeBlocks(props: HomeBlockProps) {
  const scope = useRequestContext();
  const pages = useKnowledgeCatalog(scope);
  if (pages.isError) return <KnowledgeStatus state="failed" retry={() => { void pages.refetch(); }} />;
  if (!pages.data) return <KnowledgeStatus state="loading" />;
  return props.block.kind === 'board'
    ? <BoardBlock {...props} scope={scope} pages={pages.data} />
    : <GraphBlock {...props} scope={scope} pages={pages.data} />;
}
