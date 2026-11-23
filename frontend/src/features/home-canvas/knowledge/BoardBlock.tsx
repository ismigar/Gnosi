import { lazy, Suspense, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { readOnlyDashboardView } from '../../vault';
import { fetchVaultPagesByTable, type VaultSidebarPageSummary } from '../../../shared/api/vaults';
import type { RequestContext } from '../../../shared/api/request-context';
import { isDashboardPage } from '../../../shared/records/model/pageKind';
import { readablePageTitle } from '../../../shared/records/pageReferenceTitle';
import { knowledgeDocumentPath } from '../../../shared/routing/vaultRouting';
import type { HomeBlockProps } from '../model';
import type { BoardView } from './dashboardModel';
import { KnowledgePicker, KnowledgeStatus } from './KnowledgeFields';
import { readDashboard, useKnowledgeQuery } from './knowledgeQueries';

const VaultMarkdown = lazy(() => import('../../../shared/editor/VaultMarkdown'));
interface Props extends HomeBlockProps { readonly scope: RequestContext; readonly pages: readonly VaultSidebarPageSummary[] }

function LiveView({ part, registered, boardId, scope }: {
  readonly part: BoardView; readonly registered?: Readonly<Record<string, unknown>>;
  readonly boardId: string; readonly scope: RequestContext;
}) {
  const { t } = useTranslation();
  const projection = useKnowledgeQuery(scope, ['view', boardId, part.key, part.view, registered], signal =>
    readOnlyDashboardView(boardId, part.view, registered, tableId => fetchVaultPagesByTable(tableId, {}, signal, scope)));
  const result = projection.data;
  const registeredTitle = typeof registered?.displayTitle === 'string' ? registered.displayTitle.trim() : '';
  const registeredName = typeof registered?.name === 'string' ? registered.name.trim() : '';
  const title = registeredTitle || part.label || registeredName || t('home_canvas.knowledge.view');
  return <section className="home-knowledge-view">
    <h4>{title}</h4>
    {projection.isError ? <KnowledgeStatus state="failed" retry={() => { void projection.refetch(); }} />
      : projection.isPending ? <KnowledgeStatus state="loading" />
      : !result ? <p className="home-knowledge-status">{t('home_canvas.knowledge.unavailable')}</p>
      : !result.total ? <p className="home-knowledge-status">{t('home_canvas.knowledge.noMatches')}</p>
      : <>
        <div className="home-knowledge-table-wrap"><table><thead><tr>
          <th scope="col">{t('home_canvas.knowledge.record')}</th>
          {result.columns.map((column, index) => <th key={index} scope="col">{column}</th>)}
        </tr></thead><tbody>
          {result.records.map((record, index) => <tr key={`${record.id}-${String(index)}`}>
            <td><Link to={knowledgeDocumentPath(record.id)}>{readablePageTitle(record.title)}</Link></td>
            {record.cells.map((cell, column) => <td key={column}>{cell}</td>)}
          </tr>)}
        </tbody></table></div>
        {result.total > result.records.length && <p className="home-knowledge-status">
          {t('home_canvas.knowledge.showing', { shown: result.records.length, total: result.total })}</p>}
      </>}
  </section>;
}

export function BoardBlock({ block, editing, onConfigure, pages, scope }: Props) {
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
  const titles = useMemo(() => Object.fromEntries(pages.map(page => [page.id, page.title])), [pages]);
  return <div className="home-knowledge-block">
    {editing && <KnowledgePicker label={t('home_canvas.knowledge.board')} placeholder={t('home_canvas.knowledge.firstBoard')}
      value={configuredBoard} choices={boards} onChange={id => { onConfigure({ ...block.settings, boardId: id, section: '' }); }} />}
    {board && <Link className="home-knowledge-source" to={knowledgeDocumentPath(board.id, { is_dashboard: true })}>{readablePageTitle(board.title)}</Link>}
    {editing && dashboard && (dashboard.layout.choices.length > 0 || section) && <label className="home-knowledge-field">
      {t('home_canvas.knowledge.section')}<select className="home-field" value={section}
        onChange={event => { onConfigure({ ...block.settings, boardId: event.target.value ? boardId : configuredBoard, section: event.target.value }); }}>
        <option value="">{t('home_canvas.knowledge.wholeBoard')}</option>
        {section && !parts && <option value={section}>{t('home_canvas.knowledge.unavailable')}</option>}
        {dashboard.layout.choices.map(choice => <option key={choice.key} value={choice.key}>{choice.label || dashboard.registered.find(view => view.id === choice.viewId)?.name || t('home_canvas.knowledge.view')}</option>)}
      </select></label>}
    {!board ? <p className="home-knowledge-status">{configuredBoard ? t('home_canvas.knowledge.missingBoard') : t('home_canvas.knowledge.noBoards')}</p>
      : content.isError ? <KnowledgeStatus state="failed" retry={() => { void content.refetch(); }} />
      : content.isPending ? <KnowledgeStatus state="loading" />
      : !dashboard ? <p className="home-knowledge-status">{t('home_canvas.knowledge.missingBoard')}</p>
      : !parts ? <p className="home-knowledge-status">{t('home_canvas.knowledge.missingSection')}</p>
      : !parts.length ? <p className="home-knowledge-status">{t('home_canvas.knowledge.emptyBoard')}</p>
      : <div className="home-knowledge-sections">{parts.map(part => part.kind === 'view'
        ? <LiveView key={part.key} part={part} registered={dashboard.registered.find(view => view.id === part.view.view_id)} boardId={boardId} scope={scope} />
        : <Suspense key={part.key} fallback={<KnowledgeStatus state="loading" />}><VaultMarkdown md={part.markdown} idToTitle={titles}
          vaultId={scope.vaultId} sourcePageId={boardId} allowVaultQueries
          onOpenInCurrentTab={id => { void navigate(knowledgeDocumentPath(id)); }} /></Suspense>)}</div>}
  </div>;
}
