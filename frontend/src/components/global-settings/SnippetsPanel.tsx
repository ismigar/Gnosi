import { configurableGap } from './settingsStyles';
import { FileText } from 'lucide-react';
import { FormGroup } from './SettingsPrimitives';
import { InlineEditorPlacement } from './SettingsPrimitives';
import { Plus } from 'lucide-react';
import React from 'react';
import { Section } from './SettingsPrimitives';
import { Trash2 } from 'lucide-react';
import type { SettingsController } from './useGlobalSettingsController';

type Props = { context: Pick<SettingsController, 'editingSnippetId' | 'handleAddSnippet' | 'handleDeleteSnippet' | 'handleEditSnippet' | 'setEditingSnippetId' | 'setSnippetDraft' | 'setSnippetEditorTarget' | 'snippetDraft' | 'snippetEditorTarget' | 'snippets' | 't' | 'tn'> };

export function SnippetsPanel({ context }: Props) {
  const { editingSnippetId, handleAddSnippet, handleDeleteSnippet, handleEditSnippet, setEditingSnippetId, setSnippetDraft, setSnippetEditorTarget, snippetDraft, snippetEditorTarget, snippets, t, tn } = context;
  return (<Section title={tn('snippets.title')} icon={FileText}>
    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>
      {tn('snippets.intro')}
    </p>

    {/* List of existing fragments */}
    {snippets.length > 0 && (
      <div className="settings-configurable-list" style={{ ...configurableGap('8px'), marginBottom: '24px' }}>
        {snippets.map(s => (
          <React.Fragment key={s.id}>
            <div
              className={`settings-configurable-item ${editingSnippetId === s.id ? 'is-editing' : ''}`}
              data-settings-item-id={`snippet:${s.id}`}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: '12px',
                padding: '14px 16px', background: 'var(--settings-bg)',
                border: '1px solid var(--settings-border)'
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: '700', fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: '4px' }}>{s.title}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: '1.4', overflow: 'hidden', maxHeight: '3.6em' }}>{s.content}</div>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                <button
                  onClick={() => { handleEditSnippet(s); }}
                  style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'transparent', color: 'var(--gnosi-blue)', fontSize: '0.75rem', fontWeight: '700', cursor: 'pointer' }}
                >
                  {t('common.edit')}
                </button>
                <button
                  onClick={() => { handleDeleteSnippet(s.id); }}
                  style={{ padding: '6px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            {editingSnippetId === s.id && (
              <div
                ref={setSnippetEditorTarget}
                data-settings-editor-anchor-for={`snippet:${s.id}`}
              />
            )}
          </React.Fragment>
        ))}
      </div>
    )}

    {/* Add/edit form */}
    <InlineEditorPlacement
      target={editingSnippetId ? snippetEditorTarget : null}
      waitForTarget={Boolean(editingSnippetId)}
    >
      <div
        className={`settings-inline-editor settings-inline-editor-compact ${editingSnippetId ? 'is-attached' : 'is-create'}`}
        data-settings-editor-for={editingSnippetId ? `snippet:${editingSnippetId}` : 'snippet:new'}
      >
        {!editingSnippetId && (
          <h4 className="settings-inline-editor-heading">{tn('snippets.new_snippet')}</h4>
        )}
        <FormGroup label={tn('snippets.title_label')} description={tn('snippets.title_desc')}>
          <input
            type="text"
            className="gnosi-input"
            placeholder={tn('snippets.title_placeholder')}
            value={snippetDraft.title}
            onChange={e => { setSnippetDraft(d => ({ ...d, title: e.target.value })); }}
            onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
          />
        </FormGroup>
        <FormGroup label={tn('snippets.content_label')} description={tn('snippets.content_desc')}>
          <textarea
            className="gnosi-input"
            rows={4}
            placeholder={tn('snippets.content_placeholder')}
            value={snippetDraft.content}
            onChange={e => { setSnippetDraft(d => ({ ...d, content: e.target.value })); }}
            style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: '1.5' }}
          />
        </FormGroup>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          {editingSnippetId && (
            <button
              onClick={() => { setEditingSnippetId(null); setSnippetDraft({ title: '', content: '' }); }}
              style={{ padding: '10px 20px', borderRadius: '12px', border: '1px solid var(--settings-border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer' }}
            >
              {t('common.cancel')}
            </button>
          )}
          <button
            onClick={handleAddSnippet}
            disabled={!snippetDraft.title.trim() || !snippetDraft.content.trim()}
            style={{ padding: '10px 24px', borderRadius: '12px', border: 'none', background: 'var(--gnosi-blue)', color: 'white', fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', opacity: (!snippetDraft.title.trim() || !snippetDraft.content.trim()) ? 0.5 : 1 }}
          >
            <Plus size={16} />
            {editingSnippetId ? tn('snippets.update') : tn('snippets.add')}
          </button>
        </div>
      </div>
    </InlineEditorPlacement>
  </Section>);
}
