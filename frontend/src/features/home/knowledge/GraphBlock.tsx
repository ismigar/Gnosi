import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight } from 'lucide-react';
import type { RequestContext } from '../../../shared/api/request-context';
import { fetchBlockEditorBacklinks, fetchBlockEditorOutlinks } from '../../../shared/api/block-editor';
import type { VaultSidebarPageSummary } from '../../../shared/api/vaults';
import { isKnowledgeNote, parsePersonalEdits, personalEditsSnapshot, subscribePersonalEdits } from '../../../shared/records/personalNoteEdits';
import { readablePageTitle } from '../../../shared/records/pageReferenceTitle';
import { knowledgeDocumentPath } from '../../../shared/routing/vaultRouting';
import type { HomeBlockProps } from '../model';
import { KnowledgePicker, KnowledgeStatus } from './KnowledgeFields';
import { graphNeighbors, latestDatedNote } from './graphModel';
import { useKnowledgeQuery } from './knowledgeQueries';

interface Props extends HomeBlockProps { readonly scope: RequestContext; readonly pages: readonly VaultSidebarPageSummary[] }

export function GraphBlock({ block, editing, onConfigure, scope, pages }: Props) {
  const { t } = useTranslation();
  const subscribe = useCallback((notify: () => void) => subscribePersonalEdits(notify, scope), [scope]);
  const snapshot = useSyncExternalStore(subscribe, () => personalEditsSnapshot(scope), () => '[]');
  const edits = useMemo(() => parsePersonalEdits(snapshot), [snapshot]);
  const notes = useMemo(() => pages.filter(isKnowledgeNote).sort((a, b) => a.title.localeCompare(b.title)), [pages]);
  const byId = useMemo(() => new Map(notes.map(note => [note.id, note])), [notes]);
  const pinned = block.settings.pageId || '';
  const lastEdited = edits.find(edit => byId.has(edit.id))?.id;
  const fallback = useMemo(() => pinned || lastEdited ? '' : latestDatedNote(notes), [lastEdited, notes, pinned]);
  const centerId = pinned || lastEdited || fallback;
  const center = byId.get(centerId);
  const links = useKnowledgeQuery(scope, ['links', centerId], async signal => {
    const [incoming, outgoing] = await Promise.all([
      fetchBlockEditorBacklinks(centerId, signal, scope),
      fetchBlockEditorOutlinks(centerId, signal, scope),
    ]);
    return { incoming, outgoing: [...outgoing.links, ...outgoing.relations] };
  }, Boolean(center));
  const neighbors = links.data ? graphNeighbors(centerId, links.data.incoming, links.data.outgoing, byId, edits) : [];
  return <div className="home-knowledge-block">
    {editing && <KnowledgePicker label={t('home_canvas.knowledge.center')} placeholder={t('home_canvas.knowledge.lastEdited')}
      value={pinned} choices={notes} onChange={pageId => { onConfigure({ ...block.settings, pageId }); }} />}
    {!center ? <p className="home-knowledge-status">{pinned ? t('home_canvas.knowledge.missingNote')
      : notes.length ? t('home_canvas.knowledge.noEdits') : t('home_canvas.knowledge.noNotes')}</p>
      : <>{fallback && <p className="home-knowledge-status">{t('home_canvas.knowledge.recentVault')}</p>}
        <div className="home-knowledge-map" role="group" aria-label={t('home_canvas.knowledge.map', { title: readablePageTitle(center.title) })}>
        <Link className="home-knowledge-node home-knowledge-center" to={knowledgeDocumentPath(center.id)} title={readablePageTitle(center.title)}>
          <span aria-hidden="true" className="home-knowledge-dot" />{readablePageTitle(center.title)}</Link>
        {neighbors.length > 0 && <>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false" aria-hidden="true">
            {neighbors.map((neighbor, index) => <path key={neighbor.id}
              d={`M 0 50 C 50 50, 50 ${String((index + .5) * 100 / neighbors.length)}, 100 ${String((index + .5) * 100 / neighbors.length)}`} />)}
          </svg>
          <ul className="home-knowledge-neighbors">{neighbors.map(note => {
            const Icon = note.incoming && note.outgoing ? ArrowLeftRight : note.outgoing ? ArrowUpRight : ArrowDownLeft;
            const direction = note.incoming && note.outgoing ? t('home_canvas.knowledge.both') : note.outgoing ? t('home_canvas.knowledge.outgoing') : t('home_canvas.knowledge.incoming');
            return <li key={note.id}><Link className="home-knowledge-node" to={knowledgeDocumentPath(note.id)}
              title={`${readablePageTitle(note.title)} · ${direction}`}><Icon size={13} aria-hidden="true" />
              <span>{readablePageTitle(note.title)}</span><span className="sr-only"> · {direction}</span></Link></li>;
          })}</ul>
        </>}
      </div>
      {links.isError ? <KnowledgeStatus state="failed" retry={() => { void links.refetch(); }} />
        : links.isPending ? <KnowledgeStatus state="loading" />
        : !neighbors.length && <p className="home-knowledge-status">{t('home_canvas.knowledge.noLinks')}</p>}
      </>}
  </div>;
}
