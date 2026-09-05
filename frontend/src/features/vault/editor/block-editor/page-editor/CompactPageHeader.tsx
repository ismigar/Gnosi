import { emitAppEvent } from '../../../../../shared/platform/app-events';
import { FileText } from 'lucide-react';
import { IconRenderer } from '../../../../../shared/ui/previews/IconRenderer';
import { Link2 } from 'lucide-react';
import { PageActionsBar } from '../../PageActionsBar';
import { PanelBottomOpen } from 'lucide-react';
import { Settings } from 'lucide-react';
import { Sparkles } from 'lucide-react';
import { SpellCheck2 } from 'lucide-react';
import type { PageEditorController } from './usePageEditorController';
import { PageSpellLanguage } from './PageSpellLanguage';
export function CompactPageHeader({ context }: { context: PageEditorController }) {
  const { isPageHeaderCompact, setIsIconPickerOpen, t, metadata, showKnowledgePanels, toggleCompactPanel, openCompactPanelPreview, scheduleCompactPanelPreviewClose, compactPanelPreview, isPropertiesOpen, properties, adhocProperties, compactPropertyPreviewItems, isLinksInfoOpen, compactLinkPreviewSections, pageActions, isActivePage, contentWidth, spellEnabled, spellLang, setSpellEnabled, isFloatingDockOpen, setIsFloatingDockOpen } = context;
  return (isPageHeaderCompact && (
    <div className="vault-page-compact-header">
      <div className="vault-page-compact-header__identity">
        <button
          type="button"
          className="vault-page-compact-header__icon"
          onClick={() => { setIsIconPickerOpen(true); }}
          title={t('common.icon')}
          aria-label={t('common.icon')}
        >
          {metadata.icon ? <IconRenderer icon={metadata.icon} size={18} /> : <FileText size={18} />}
        </button>
        <span className="vault-page-compact-header__title" title={metadata.title || t('editor.untitled')}>
          {metadata.title || t('editor.untitled')}
        </span>
      </div>
      <div className="vault-page-compact-header__actions">
        {showKnowledgePanels && (
          <>
            <div className="vault-page-compact-header__preview-anchor">
              <button
                type="button"
                className="vault-page-compact-header__action"
                onClick={() => { toggleCompactPanel('properties'); }}
                onMouseEnter={() => { openCompactPanelPreview('properties'); }}
                onMouseLeave={scheduleCompactPanelPreviewClose}
                onFocus={() => { openCompactPanelPreview('properties'); }}
                onBlur={scheduleCompactPanelPreviewClose}
                title={t('editor.toggle_properties')}
                aria-label={t('editor.toggle_properties')}
                aria-describedby={compactPanelPreview === 'properties' ? 'vault-compact-properties-preview' : undefined}
                aria-expanded={isPropertiesOpen}
              >
                <Settings size={16} />
              </button>
              {compactPanelPreview === 'properties' && (
                <div
                  id="vault-compact-properties-preview"
                  role="tooltip"
                  className="vault-page-compact-header__preview"
                  onMouseEnter={() => { openCompactPanelPreview('properties'); }}
                  onMouseLeave={scheduleCompactPanelPreviewClose}
                >
                  <div className="vault-page-compact-header__preview-heading">
                    <Settings size={14} />
                    <span>{t('common.properties')}</span>
                    <span className="vault-page-compact-header__preview-count">{properties.length + adhocProperties.length}</span>
                  </div>
                  {compactPropertyPreviewItems.length > 0 ? (
                    <dl className="vault-page-compact-header__preview-list">
                      {compactPropertyPreviewItems.map(item => (
                        <div key={item.name} className="vault-page-compact-header__preview-row">
                          <dt>{item.name}</dt>
                          <dd title={item.value}>{item.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="vault-page-compact-header__preview-empty">{t('common.empty')}</p>
                  )}
                </div>
              )}
            </div>
            <div className="vault-page-compact-header__preview-anchor">
              <button
                type="button"
                className="vault-page-compact-header__action"
                onClick={() => { toggleCompactPanel('links'); }}
                onMouseEnter={() => { openCompactPanelPreview('links'); }}
                onMouseLeave={scheduleCompactPanelPreviewClose}
                onFocus={() => { openCompactPanelPreview('links'); }}
                onBlur={scheduleCompactPanelPreviewClose}
                title={t('editor.links_and_mentions')}
                aria-label={t('editor.links_and_mentions')}
                aria-describedby={compactPanelPreview === 'links' ? 'vault-compact-links-preview' : undefined}
                aria-expanded={isLinksInfoOpen}
              >
                <Link2 size={16} />
              </button>
              {compactPanelPreview === 'links' && (
                <div
                  id="vault-compact-links-preview"
                  role="tooltip"
                  className="vault-page-compact-header__preview"
                  onMouseEnter={() => { openCompactPanelPreview('links'); }}
                  onMouseLeave={scheduleCompactPanelPreviewClose}
                >
                  <div className="vault-page-compact-header__preview-heading">
                    <Link2 size={14} />
                    <span>{t('editor.links_and_mentions')}</span>
                  </div>
                  <div className="vault-page-compact-header__preview-link-sections">
                    {compactLinkPreviewSections.map(section => (
                      <div key={section.key} className="vault-page-compact-header__preview-link-section">
                        <div className="vault-page-compact-header__preview-link-label">
                          <span>{section.label}</span>
                          <span className="vault-page-compact-header__preview-count">{section.count}</span>
                        </div>
                        {section.previewItems.length > 0 && (
                          <ul>
                            {section.previewItems.map((item, index) => <li key={`${section.key}-${item}-${String(index)}`} title={item}>{item}</li>)}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                  {compactLinkPreviewSections.every(section => section.count === 0) && (
                    <p className="vault-page-compact-header__preview-empty">{t('editor.links_graph_empty')}</p>
                  )}
                </div>
              )}
            </div>
          </>
        )}
        <PageSpellLanguage context={context} />
        <PageActionsBar
          compactHeader
          pageActions={isActivePage ? pageActions : null}
          containerWidth={contentWidth}
          compactOverflowItems={isActivePage ? [{
            key: 'spellcheck',
            Icon: SpellCheck2,
            active: spellEnabled,
            label: spellEnabled
              ? t('editor.spellcheck_active', { lang: spellLang.toUpperCase() })
              : t('editor.spellcheck_disabled'),
            onClick: () => { setSpellEnabled((value) => !value); },
          }, {
            key: 'ai-correct',
            Icon: Sparkles,
            label: t('editor.ai_correct_page'),
            onClick: () => emitAppEvent('gnosi:ai-correct-page'),
          }, {
            key: 'quick-actions',
            Icon: PanelBottomOpen,
            active: isFloatingDockOpen,
            label: isFloatingDockOpen
              ? t('shell.close_quick_actions', 'Close quick actions')
              : t('shell.open_quick_actions', 'Open quick actions'),
            onClick: () => { setIsFloatingDockOpen((value) => !value); },
          }] : []}
        />
      </div>
    </div>
  ));
}
