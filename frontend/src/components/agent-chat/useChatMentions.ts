import { useCallback, useEffect, useReducer, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchVaultDatabases, fetchVaultPages, fetchVaultTables } from '../../shared/api/vaults';
import type { AgentChatMention } from '../agentChatMentionUtils';
import { catalogMentions, EMPTY_MENTION_MENU, insertChatMention, mentionMenuReducer, queryMentionMenu, type CatalogMention } from './composerModel';
import { logChatError } from './chatDiagnostics';

interface Options {
  readonly inputValue: string;
  readonly inputRef: RefObject<HTMLTextAreaElement | null>;
  readonly setInputValue: Dispatch<SetStateAction<string>>;
  readonly setSelectedMentions: Dispatch<SetStateAction<AgentChatMention[]>>;
}

export function useChatMentions({ inputValue, inputRef, setInputValue, setSelectedMentions }: Options) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<CatalogMention[]>([]);
  const [menu, dispatch] = useReducer(mentionMenuReducer, EMPTY_MENTION_MENU);
  const setShowMentionMenu = useCallback((value: boolean) => { dispatch({ type: 'open', value }); }, []);
  useEffect(() => {
    dispatch({ type: 'query', value: queryMentionMenu(inputValue, inputRef.current?.selectionStart ?? inputValue.length, catalog) });
  }, [inputValue, inputRef, catalog]);
  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.style.height = 'auto';
    inputRef.current.style.height = `${String(inputRef.current.scrollHeight)}px`;
  }, [inputValue, inputRef]);

  const loadMentionCatalog = useCallback(async () => {
    try {
      const [pages, tables, databases] = await Promise.all([fetchVaultPages(), fetchVaultTables(), fetchVaultDatabases()]);
      setCatalog([
        ...catalogMentions(pages, 'page', t('chat.mention_type_page', 'Page')),
        ...catalogMentions(tables, 'table', t('chat.mention_type_table', 'Table')),
        ...catalogMentions(databases, 'database', t('chat.mention_type_database', 'DB')),
      ]);
    } catch (error) { logChatError('agent-chat-mention-catalog', error); }
  }, [t]);

  const applyMention = (item: CatalogMention) => {
    const inserted = insertChatMention(inputValue, inputRef.current?.selectionStart ?? inputValue.length, menu.anchor, item);
    if (!inserted) return;
    setInputValue(inserted.value);
    setSelectedMentions((previous) => [...previous.filter((mention) => mention.token !== inserted.mention.token), inserted.mention]);
    dispatch({ type: 'clear' });
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(inserted.caret, inserted.caret);
    });
  };
  return { loadMentionCatalog, applyMention, setShowMentionMenu, showMentionMenu: menu.open, mentionResults: menu.results };
}
