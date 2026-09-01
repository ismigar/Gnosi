import { useTranslation } from 'react-i18next';
import type { NotebookController } from './useNotebookController';
import { useRef, type KeyboardEvent } from 'react';
import { BookOpen, MessageSquare, Settings2 } from 'lucide-react';
import { MOBILE_TAB_IDS, nextMobileTab } from './notebookModel';
import type { MobileTab } from './notebookTypes';

export default function NotebookMobileTabs({ controller }: { controller: NotebookController }) {
    const { t } = useTranslation();
    const { mobileTab, setMobileTab } = controller;
    const mobileTabRefs = useRef<Partial<Record<MobileTab, HTMLButtonElement | null>>>({});
    const selectMobileTabFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, currentTab: MobileTab) => {
        const nextTab = nextMobileTab(currentTab, event.key);
        if (!nextTab) return;
        event.preventDefault();
        setMobileTab(nextTab);
        mobileTabRefs.current[nextTab]?.focus();
    };
    return (
            <div
                className="notebook-mobile-tabs"
                role="tablist"
                aria-label={t('notebooks.mobile_tabs_label', 'Notebook sections')}
            >
                {MOBILE_TAB_IDS.map((tabId) => {
                    const labels = {
                        sources: t('notebooks.sources_tab', 'Sources'),
                        chat: t('notebooks.chat_tab', 'Conversation'),
                        settings: t('notebooks.settings_tab', 'Settings'),
                    };
                    const icons = { sources: BookOpen, chat: MessageSquare, settings: Settings2 };
                    const Icon = icons[tabId];
                    const selected = mobileTab === tabId;
                    return (
                        <button
                            key={tabId}
                            id={`notebook-${tabId}-tab`}
                            ref={(element) => { mobileTabRefs.current[tabId] = element; }}
                            type="button"
                            role="tab"
                            aria-selected={selected}
                            aria-controls={`notebook-${tabId}-panel`}
                            tabIndex={selected ? 0 : -1}
                            className={selected ? 'is-active' : ''}
                            onClick={() => { setMobileTab(tabId); }}
                            onKeyDown={(event) => { selectMobileTabFromKeyboard(event, tabId); }}
                        >
                            <Icon size={15} aria-hidden="true" />
                            {labels[tabId]}
                        </button>
                    );
                })}
            </div>

    );
}
