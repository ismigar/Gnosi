import type { PageMetadata, SaveStatus, ViewEditingBlock, ApplyViewSection, CompactPanel, PageEditorApi, PropertyClipboard } from './types';
import type { BlockEditorPageLink, BlockEditorUnlinkedMention } from '../../../../../shared/api/block-editor';
import { readStorage, spellEnabledKey } from './preferences';
import { legacyText } from './valueBoundaries';
import { extractOutgoingPageLinks } from '../outgoingLinks';
import { shouldShowKnowledgePanels } from '../../metadataVisibilityUtils';
import { useApi } from '../../../../../shared/api/use-api';
import { useFloatingActionDock } from '../../../../../shared/hooks/useFloatingActionDock';
import { useLocaleSettings } from '../../../../../shared/i18n/useLocaleSettings';
import { usePlugins } from '../../../../../shared/plugins/usePlugins';
import { useRef } from 'react';
import { useState } from 'react';
import { useTheme } from '../../../../../shared/hooks/useTheme';
import { useTranslation } from 'react-i18next';
import type { PageEditorProps } from './types';
export function usePageEditorState(props: PageEditorProps) {
  const { noteFilename, initialContent, initialMetadata = {}, onUpdate, allTables = [], allNotes = [], onEditSchema, onAddSchemaOption, onCreateRecord, onCreateTemplate, onCreateFromSource, onDeletePage = () => { }, onOpenParallel = () => { }, onOpenPage = () => { }, onOpenInCurrentTab = null, onOpenInNewTab = null, idToTitle = {}, aliasIndex = {}, registry = { databases: [], tables: [], views: [] }, onRefreshNotes = () => { }, onUpdatePageMetadata, historyOpenSignal = 0, isCodeView = false, isEditLocked = false, referenceTableId = null, onOpenViewConfig, pageActions = null, isActivePage = true } = props;

  const { t } = useTranslation();

  const { role } = useApi();

  const { isEnabled: isPluginEnabled, getPluginSettings } = usePlugins();

  const projectPlanningEnabled = isPluginEnabled('project-planning');

  const projectPlanningSettings = getPluginSettings('project-planning');

  const [isFloatingDockOpen, setIsFloatingDockOpen] = useFloatingActionDock();

  const isViewerRole = role === 'viewer';

  const isAdmin = role === 'admin' || role === 'owner';

  // `isViewer`/`isEditor` represent the combination: viewer role OR lock of
  // the user (`isEditLocked` per page). When the user closes the lock,
  // the editor behaves as if it were a viewer for this specific page.
  const isViewer = isViewerRole || isEditLocked;

  const isEditor = !isEditLocked && (role === 'editor' || isAdmin);

  const { effectiveTheme } = useTheme();


  const isEditable = !isViewer;

  const [metadata, setMetadata] = useState<PageMetadata>(initialMetadata);

  const showKnowledgePanels = shouldShowKnowledgePanels(metadata);

  // Global format defaults (currency/number/date) for the display
  // in read mode for the properties (per-field override via config.format).
  const localeSettings = useLocaleSettings();

  // (the file:// interceptor is in the useFileLinkInterceptor hook invoked in App.jsx)

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');


  // Spell checker (Hunspell-WASM): enabled by default, persisted to
  // persistent storage. Lives here (external component) so the controls of the
  // header and body (EditorInner, where the layers live) can share it.
  // `spellLang` is reported by EditorInner via automatic language detection.
  const [spellEnabled, setSpellEnabled] = useState(() => readStorage(spellEnabledKey) !== '0');

  const [spellLang, setSpellLang] = useState('ca');


  const metadataRef = useRef(metadata);


  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // Width of the editor content pane, feeding the page-action toolbar's
  // responsive overflow (so a narrow/split pane collapses actions into "…").
  const contentRef = useRef<HTMLDivElement | null>(null);

  const [contentWidth, setContentWidth] = useState(0);

  const [isPageViewModalOpen, setIsPageViewModalOpen] = useState(false);

  const [pageViewPreselectedTable, setPageViewPreselectedTable] = useState('');

  const [pageViewEditingBlock, setPageViewEditingBlock] = useState<ViewEditingBlock | null>(null);

  // It's incremented every time a DB view's config is saved. It propagates
  // via VaultEditorContext so each DbViewEmbed re-reads its section
  // (cardSize/galleryPreview/groupBy/…) live, without having to reload:
  // editing only the size doesn't change the block's view_id/heading, so its
  // loading useEffect wasn't retriggered and the change wasn't visible (#bug).
  const [viewSectionNonce, setViewSectionNonce] = useState(0);

  // The BlockNote editor lives inside EditorInner. This ref allows the
  // PageViewModal (rendered here, outside EditorInner) to request inserting or
  // update the `gnosi_view` block once the user has saved the view.
  const applyViewSectionRef = useRef<ApplyViewSection | null>(null);

  const [isAddingProp, setIsAddingProp] = useState(false);

  const [newPropName, setNewPropName] = useState("");

  const [incomingLinks, setIncomingLinks] = useState<BlockEditorPageLink[]>([]);

  const [incomingLinksLoading, setIncomingLinksLoading] = useState(false);

  // Schema relations (metadata) connected to this page, both directions. Kept
  // separate from wiki-links so the panel counts match /api/graph (link vs
  // relation edges). See feedback_links_panel_vs_graph_divergence.
  const [relatedPages, setRelatedPages] = useState<BlockEditorPageLink[]>([]);

  const [unlinkedMentions, setUnlinkedMentions] = useState<BlockEditorUnlinkedMention[]>([]);

  const [unlinkedMentionsLoading, setUnlinkedMentionsLoading] = useState(false);

  const [linkMentionsBusy, setLinkMentionsBusy] = useState(false);

  const [liveOutgoingLinks, setLiveOutgoingLinks] = useState(() => (
    extractOutgoingPageLinks(legacyText(initialContent || ''), idToTitle, noteFilename)
  ));

  const [isPropertiesOpen, setIsPropertiesOpen] = useState(false);

  const [compactPanelPreview, setCompactPanelPreview] = useState<CompactPanel | null>(null);

  const compactPanelCloseTimerRef = useRef<number | null>(null);

  // Property cursor (grid style): the name of the active property.
  // Clicking the name selects; ↑↓ navigate; ⌘C/⌘V copy/paste the value.
  const [activeProp, setActiveProp] = useState<string | null>(null);

  const [openPropHelp, setOpenPropHelp] = useState<Record<string, boolean>>({});

  const propClipboardRef = useRef<PropertyClipboard | null>(null);
  // { value, type } — internal clipboard
  // Modal to fill in metadata (DOI/ISBN/arXiv/URL). Must live here, in the
  // same component as the Properties panel button and `handleMetaChange`.
  const [isMetadataLookupOpen, setIsMetadataLookupOpen] = useState(false);

  const [isLinksInfoOpen, setIsLinksInfoOpen] = useState(false);


  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);

  const [isCoverPickerOpen, setIsCoverPickerOpen] = useState(false);

  // Property (image field by name) for which the image selector is open
  // in the properties panel. `null` = closed.
  const [imagePickerProp, setImagePickerProp] = useState<string | null>(null);

  const iconTriggerRef = useRef<HTMLDivElement | null>(null);

  const coverTriggerRef = useRef<HTMLButtonElement | null>(null);

  const headerHoverRef = useRef<HTMLDivElement | null>(null);

  const titleInputRef = useRef<HTMLTextAreaElement | null>(null);

  // Bridge to move focus between the page's three zones (title ↔
  // properties ↔ body). The body (BlockNote) lives inside EditorInner, which
  // registers an imperative API there; the properties panel is inspected
  // via the DOM (data-prop-row attribute) to bring keyboard focus there.
  const editorApiRef = useRef<PageEditorApi | null>(null);

  const propertiesPanelRef = useRef<HTMLDivElement | null>(null);

  const propertiesHeaderRef = useRef<HTMLButtonElement | null>(null);

  const linksHeaderRef = useRef<HTMLButtonElement | null>(null);

  const [isHeaderHovered, setIsHeaderHovered] = useState(false);

  const [isPageHeaderCompact, setIsPageHeaderCompact] = useState(false);

  const [isFocusMode, setIsFocusMode] = useState(false);

  // Performs the actual PATCH. Don't call this directly from key-by-key
  // events — use handleSaveMetadata (debounced) or pass {immediate:true}.
  //
  // Coalesces overlapping PATCHes to the same page: while a save is in
  // flight, any new request stores its snapshot in `pendingMetaRef` and
  // returns immediately; when the in-flight call resolves, the latest
  // pending snapshot is flushed in a single follow-up PATCH. Without this,
  // rapid title typing fires several concurrent PATCHes that interleave
  // badly (one renames `Old.md`→`New.md` while another still reads
  // `Old.md` → 500 "Error desant markdown"). The backend now serializes
  // writes per page_id too, but coalescing here keeps the UI to a single
  // network round-trip per burst.
  const metaSaveInFlightRef = useRef<Promise<boolean> | null>(null);

  const pendingMetaRef = useRef<PageMetadata | null>(null);

  const pendingRemoveKeysRef = useRef<string[] | null>(null);


  // Debounced metadata save. Without this, every keystroke on the title or
  // every option toggle on a multi-select fires its own PATCH; on slow
  // networks the requests overlap and a faster late save can be clobbered
  // by a slower earlier one (no ordering guarantee). The dedicated ref
  // ensures only the last user action triggers a real network call.
  const metaSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);


  // When opening/loading a page, the cursor starts at the TITLE: it's the
  // entry point for keyboard zone navigation (title → properties →
  // mentions → body). Once per mount — the component remounts with
  // `key`=note id, so switching pages returns to it. We don't steal the
  // focus if the user is already typing in another field (e.g. global search) nor
  // if the editor is hidden (background tab / split panel).
  const didAutofocusTitleRef = useRef(false);
  return { ...props, noteFilename, initialContent, initialMetadata, onUpdate, allTables, allNotes, onEditSchema, onAddSchemaOption, onCreateRecord, onCreateTemplate, onCreateFromSource, onDeletePage, onOpenParallel, onOpenPage, onOpenInCurrentTab, onOpenInNewTab, idToTitle, aliasIndex, registry, onRefreshNotes, onUpdatePageMetadata, historyOpenSignal, isCodeView, isEditLocked, referenceTableId, onOpenViewConfig, pageActions, isActivePage, t, role, isPluginEnabled, getPluginSettings, projectPlanningEnabled, projectPlanningSettings, isFloatingDockOpen, setIsFloatingDockOpen, isViewerRole, isAdmin, isViewer, isEditor, effectiveTheme, isEditable, metadata, setMetadata, showKnowledgePanels, localeSettings, saveStatus, setSaveStatus, spellEnabled, setSpellEnabled, spellLang, setSpellLang, metadataRef, isHistoryOpen, setIsHistoryOpen, contentRef, contentWidth, setContentWidth, isPageViewModalOpen, setIsPageViewModalOpen, pageViewPreselectedTable, setPageViewPreselectedTable, pageViewEditingBlock, setPageViewEditingBlock, viewSectionNonce, setViewSectionNonce, applyViewSectionRef, isAddingProp, setIsAddingProp, newPropName, setNewPropName, incomingLinks, setIncomingLinks, incomingLinksLoading, setIncomingLinksLoading, relatedPages, setRelatedPages, unlinkedMentions, setUnlinkedMentions, unlinkedMentionsLoading, setUnlinkedMentionsLoading, linkMentionsBusy, setLinkMentionsBusy, liveOutgoingLinks, setLiveOutgoingLinks, isPropertiesOpen, setIsPropertiesOpen, compactPanelPreview, setCompactPanelPreview, compactPanelCloseTimerRef, activeProp, setActiveProp, openPropHelp, setOpenPropHelp, propClipboardRef, isMetadataLookupOpen, setIsMetadataLookupOpen, isLinksInfoOpen, setIsLinksInfoOpen, isIconPickerOpen, setIsIconPickerOpen, isCoverPickerOpen, setIsCoverPickerOpen, imagePickerProp, setImagePickerProp, iconTriggerRef, coverTriggerRef, headerHoverRef, titleInputRef, editorApiRef, propertiesPanelRef, propertiesHeaderRef, linksHeaderRef, isHeaderHovered, setIsHeaderHovered, isPageHeaderCompact, setIsPageHeaderCompact, isFocusMode, setIsFocusMode, metaSaveInFlightRef, pendingMetaRef, pendingRemoveKeysRef, metaSaveTimerRef, didAutofocusTitleRef };
}
