import { lazy, Suspense, useId, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DbViewEmbed } from '../../vault/views/DbViewEmbed';
import type { EmbedBlock } from '../../vault/views/db-view-embed/types';
import { VaultEditorContext, type VaultEditorContextValue } from '../../../shared/editor/VaultEditorContext';
import type { VaultSidebarPageSummary } from '../../../shared/api/vaults';
import type { RequestContext } from '../../../shared/api/request-context';
import { isDashboardPage } from '../../../shared/records/model/pageKind';
import { readablePageTitle } from '../../../shared/records/pageReferenceTitle';
import { knowledgeDocumentPath } from '../../../shared/routing/vaultRouting';
import type { HomeBlockProps } from '../model';
import { KnowledgePicker, KnowledgeStatus } from './KnowledgeFields';
import { readDashboard, useKnowledgeQuery } from './knowledgeQueries';

const VaultMarkdown = lazy(() => import('../../../shared/editor/VaultMarkdown'));
interface Props extends HomeBlockProps {
  readonly scope: RequestContext;
  readonly pages: readonly VaultSidebarPageSummary[];
  readonly catalogComplete: boolean;
  readonly refreshCount?: number;
}

export function BoardBlock({ block, editing, onConfigure, pages, scope, catalogComplete, refreshCount = 0 }: Props) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const boards = useMemo(() => pages.filter(isDashboardPage).sort((a, b) =>
    a.title.localeCompare(b.title, i18n.resolvedLanguage) || a.id.localeCompare(b.id)), [i18n.resolvedLanguage, pages]);
  const configuredBoard = block.settings.boardId || '';
  const section = block.settings.section || '';
  const board = configuredBoard ? boards.find(item => item.id === configuredBoard) : boards[0];
  const boardId = board?.id ?? '';
  const content = useKnowledgeQuery(scope, ['board', boardId], signal => readDashboard(boardId, scope, signal), Boolean(board));
  const dashboard = content.data;
  const parts = dashboard?.layout.partsFor(section);
  const slot = useId();
  const markdown = parts?.map((part, index) => part.kind === 'text' ? part.markdown
    : ['```gnosi-home-view', slot + String(index), '```'].join('\n')).join('\n\n') ?? '';
  const titles = useMemo(() => Object.fromEntries(pages.map(page => [page.id, page.title])), [pages]);
  const editorContext = useMemo<VaultEditorContextValue>(() => ({
    pageId: boardId,
    idToTitle: titles,
    allTables: [],
    onCreateRecord: null,
    onDeletePage: null,
    onEditSchema: null,
    onOpenParallel: null,
    onOpenPage: (id: unknown) => { if (typeof id === 'string') void navigate(knowledgeDocumentPath(id)); },
    onOpenInCurrentTab: (id: unknown) => { if (typeof id === 'string') void navigate(knowledgeDocumentPath(id)); },
    onOpenInNewTab: (id: unknown) => { if (typeof id === 'string') void navigate(knowledgeDocumentPath(id)); },
    isEditable: false,
    registry: {
      databases: [],
      tables: [],
      views: dashboard?.registered ?? [],
    },
  }), [boardId, titles, navigate, dashboard?.registered]);

  return <div className="home-knowledge-block">
    {editing && <KnowledgePicker catalogComplete={catalogComplete} label={t('home_canvas.knowledge.board')} placeholder={t('home_canvas.knowledge.firstBoard')}
      value={configuredBoard} choices={boards} onChange={id => { onConfigure({ ...block.settings, boardId: id, section: '' }); }} />}
    {board && <Link className="home-knowledge-source" to={knowledgeDocumentPath(board.id, { is_dashboard: true })}>{readablePageTitle(board.title)}</Link>}
    {editing && dashboard && (dashboard.layout.choices.length > 0 || section) && <label className="home-knowledge-field">
      {t('home_canvas.knowledge.section')}<select className="home-field" value={section}
        onChange={event => { onConfigure({ ...block.settings, boardId: event.target.value ? boardId : configuredBoard, section: event.target.value }); }}>
        <option value="">{t('home_canvas.knowledge.wholeBoard')}</option>
        {section && !parts && <option value={section}>{t('home_canvas.knowledge.unavailable')}</option>}
        {dashboard.layout.choices.map(choice => <option key={choice.key} value={choice.key}>{choice.label || dashboard.registered.find(view => view.id === choice.viewId)?.name || t('home_canvas.knowledge.view')}</option>)}
      </select></label>}
    {!board ? catalogComplete && <p className="home-knowledge-status">{configuredBoard ? t('home_canvas.knowledge.missingBoard') : t('home_canvas.knowledge.noBoards')}</p>
      : content.isError ? <KnowledgeStatus state="failed" retry={() => { void content.refetch(); }} />
      : content.isPending ? <KnowledgeStatus state="loading" />
      : !dashboard ? <p className="home-knowledge-status">{t('home_canvas.knowledge.missingBoard')}</p>
      : !parts ? <p className="home-knowledge-status">{t('home_canvas.knowledge.missingSection')}</p>
      : !parts.length ? <p className="home-knowledge-status">{t('home_canvas.knowledge.emptyBoard')}</p>
      : <div className="home-knowledge-sections"><Suspense fallback={<KnowledgeStatus state="loading" />}>
        <VaultEditorContext.Provider value={editorContext}>
          <VaultMarkdown md={markdown} idToTitle={titles} vaultId={scope.vaultId} sourcePageId={boardId} allowVaultQueries
            onOpenInCurrentTab={id => { void navigate(knowledgeDocumentPath(id)); }}
            renderFence={(language, token) => {
              if (language !== 'gnosi-home-view' || !token.startsWith(slot)) return null;
              const part = parts[Number(token.slice(slot.length))];
              if (part?.kind !== 'view') return null;
              const viewBlock: EmbedBlock = {
                id: part.key,
                props: {
                  section_id: typeof part.view.section_id === 'string' ? part.view.section_id : undefined,
                  view_id: typeof part.view.view_id === 'string' ? part.view.view_id : undefined,
                  heading: typeof part.view.heading === 'string' ? part.view.heading : undefined,
                  heading_level: typeof part.view.heading_level === 'number' || typeof part.view.heading_level === 'string' ? part.view.heading_level : undefined,
                  section: JSON.stringify(part.view),
                },
              };
              return <DbViewEmbed key={`${part.key}-${String(refreshCount)}-${String(catalogComplete)}`} block={viewBlock} />;
            }} />
        </VaultEditorContext.Provider>
      </Suspense></div>}
  </div>;
}
