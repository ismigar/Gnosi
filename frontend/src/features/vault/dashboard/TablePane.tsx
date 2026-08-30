import { VaultViewsHeader } from '../views/VaultViewsHeader';
import { VaultViewBody } from '../views/VaultViewBody';
import { VaultGraph } from '../views/VaultGraph';
import { readPage, readView, readViewDraft } from './readers';
import { prepareDashboardViewContext, VIEW_WRAPPERS } from './view-context';
import { applyDashboardJoins } from './joins';
import type { DashboardController } from './useDashboardController';
import { tableBodyCallbacks } from './table-callbacks';
interface Props {
  dashboard: DashboardController;
  tableId: string;
  mode: 'inline' | 'tab' | 'split';
}
export function TablePane({ dashboard: d, tableId, mode }: Props) {
  const table = d.registry.tables.find(candidate => candidate.id === tableId);
  const inline = mode === 'inline';
  const split = mode === 'split';
  const notes = inline ? d.tableNotes : d.getTableVisibleRecords(tableId);
  const templates = inline ? d.tableTemplates : d.pages.filter(page => d.resolvePageTableId(page) === tableId && page.metadata?.is_template);
  const views = d.getTableViews(tableId);
  // The catalog always supplies a virtual main view for an empty table.
  const first = views[0];
  if (!first)
    return null;
  const currentViewId = inline ? (d.activeViewId || 'default')
    : d.activeTableId === tableId ? (d.activeViewId || first.id) : first.id;
  const view = views.find(candidate => candidate.id === currentViewId) || first;
  const { mergedView, mergedSchema } = prepareDashboardViewContext(view, table, d.registry.tables);
  const selectTable = () => {
    if (!inline)
      d.setActiveTableId(tableId);
  };
  const editBodySchema = (section?: string) => {
    selectTable();
    if (section === 'filters' || section === 'sorts') {
      d.setViewToConfigure(view);
      d.setViewConfigTab(section);
      d.setIsViewConfigOpen(true);
    }
    else
      d.setIsSchemaModalOpen(true);
  };
  const createTemplate = () => {
    d.setPromptModal({
      isOpen: true, defaultTitle: d.t('common.new_template'), parentId: null,
      isDatabase: false, isDrawing: false, isView: false, isTemplate: true,
      inputValue: d.t('common.new_template'), isLoading: false
    });
  };
  const headerExtra = {
    onSetViewHidden: (target: unknown, hidden: boolean) => d.handleSetViewHidden(readViewDraft(target), hidden),
    ...(!inline && !split ? {} : { onConfigureFields: () => { selectTable(); d.setIsSchemaModalOpen(true); } }),
  };
  const bodyExtra = inline ? {
    onCreateTemplate: createTemplate,
    onDuplicateTemplate: d.handleDuplicateTemplate,
    onSetDefaultTemplate: d.handleSetDefaultTemplate,
  } : {};
  const body = view.type === 'graph' ? (<VaultGraph
    tableId={tableId}
    view={view}
    searchTerm={d.searchTerm}
    isDarkMode={document.documentElement.classList.contains('dark')}
    onNodeClick={nodeId => { void d.loadPage(nodeId); }}
  />) : (<VaultViewBody
    {...bodyExtra}
    {...tableBodyCallbacks(d, tableId, inline ? view.id : currentViewId, split)}
    type={mergedView.type}
    functionalities={table?.functionalities}
    notes={applyDashboardJoins(notes, view.joins, d.pages, d.resolvePageTableId)}
    templates={templates}
    schema={mergedSchema}
    idToTitle={d.globalIndex}
    allNotes={d.pages}
    activeView={mergedView}
    searchTerm={d.searchTerm}
    {...(mode === 'tab' ? {} : { isEmbedded: split, actionRules: table?.action_rules })}
    restoreRecordFocus={d.recordReturnFocus?.isArmed === true && d.recordReturnFocus.tableId === tableId
      && d.consumedRecordReturnFocus !== d.recordReturnFocus.requestId
      && (!d.recordReturnFocus.viewId || d.recordReturnFocus.viewId === (inline ? view.id : currentViewId)) ? d.recordReturnFocus : null}
    onEditSchema={editBodySchema}
  />);
  const wrapper = VIEW_WRAPPERS[view.type];
  return <div className={inline ? 'flex-1 flex flex-col overflow-hidden min-w-0 bg-[var(--bg-primary)]'
    : split ? 'h-full flex flex-col bg-white border-l border-slate-200 shadow-xl overflow-hidden min-w-[350px]'
      : 'h-full flex flex-col bg-white'}>
    <VaultViewsHeader
      {...headerExtra}
      tableName={table?.title || table?.name || d.t('common.table')}
      recordCount={notes.length}
      notes={notes}
      referenceTableId={d.refTableId === tableId ? tableId : undefined}
      brainTableId={d.brainTableId === tableId ? tableId : undefined}
      onReferencesImported={d.fetchPages}
      onCreateFromSource={() => { d.setCreateSourceTableId(tableId); }}
      views={views}
      activeViewId={currentViewId}
      onViewSelect={id => { selectTable(); d.setActiveViewId(id); }}
      onAddView={d.handleAddView}
      onEditView={target => { d.handleConfigureView(readViewDraft(target)); }}
      onDuplicateView={target => d.handleDuplicateView(readViewDraft(target))}
      onDeleteView={target => { d.handleDeleteView(readViewDraft(target)); }}
      onReorderViews={reordered => d.handleReorderViews(reordered.map(readView))}
      onRenameView={target => { d.handleRenameView(readViewDraft(target)); }}
      onEditSchema={section => {
        selectTable();
        if (section === 'schema')
          d.setIsSchemaModalOpen(true);
        else {
          d.setViewToConfigure(view);
          d.setIsViewConfigOpen(true);
          d.setViewConfigTab(section === 'filters' ? 'filters' : 'sort');
        }
      }}
      onCreateRecord={templateId => d.handleAddNewNote(tableId, templateId)}
      onCreateTemplate={mode === 'tab' ? createTemplate : () => { d.handleAddView('template'); }}
      onEditTemplate={template => d.loadPage(template.id)}
      onDuplicateTemplate={template => d.handleDuplicateTemplate(readPage(template))}
      onSetDefaultTemplate={template => d.handleSetDefaultTemplate(readPage(template))}
      onDeleteTemplate={template => { d.setTemplateToDelete(readPage(template)); }}
      searchTerm={d.searchTerm}
      setSearchTerm={d.setSearchTerm}
      templates={templates}
      {...(split ? { onClose: () => { d.setSplitTableIds(previous => previous.filter(id => id !== tableId)); } } : {})}
    />
    <div className={inline ? 'flex-1 overflow-hidden' : 'flex-1 overflow-hidden flex flex-col'}>
      {view.type === 'graph' ? inline ? <div className="h-full flex flex-col">{body}</div> : body
        : wrapper ? <div className={wrapper}>{body}</div> : body}
    </div>
  </div>;
}
