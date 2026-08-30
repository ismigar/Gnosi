import type { Snippet } from './types';
import { writeStorage, snippetsKey } from './settingsStorage';
import type { SettingsState } from './stateTypes';

type Input = SettingsState;

export function useSettingsSnippets(state: Input) {
  const { editingSnippetId, setEditingSnippetId, setSnippetDraft, setSnippets, snippetDraft, snippets } = state;
  const saveSnippets = (list: Snippet[]) => {
    setSnippets(list);
    writeStorage(snippetsKey, list);
  };

  const handleAddSnippet = () => {
    if (!snippetDraft.title.trim() || !snippetDraft.content.trim()) return;
    if (editingSnippetId) {
      saveSnippets(snippets.map(s => s.id === editingSnippetId ? { ...s, ...snippetDraft } : s));
      setEditingSnippetId(null);
    } else {
      saveSnippets([...snippets, { id: `snip_${String(Date.now())}`, ...snippetDraft }]);
    }
    setSnippetDraft({ title: '', content: '' });
  };

  const handleEditSnippet = (s: Snippet) => {
    setEditingSnippetId(s.id);
    setSnippetDraft({ title: s.title, content: s.content });
  };

  const handleDeleteSnippet = (id: string) => {
    saveSnippets(snippets.filter(s => s.id !== id));
    if (editingSnippetId === id) { setEditingSnippetId(null); setSnippetDraft({ title: '', content: '' }); }
  };
  return { handleAddSnippet, handleDeleteSnippet, handleEditSnippet, saveSnippets };
}
