import { BookOpenCheck, LibraryBig, Search } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { AppHeader } from '../components/AppHeader';
import { useKeyboardScroll } from '../hooks/useKeyboardScroll';
import { usePlugins } from '../plugins/usePlugins';
import { ReviewWorkspace } from './literature/ReviewWorkspace';
import { SearchWorkspace } from './literature/SearchWorkspace';
import { useLiteratureSearch } from './literature/useLiteratureSearch';
import './LiteraturePage.css';

function translationLanguage(value: unknown): string {
  if (!value || typeof value !== 'object' || !('language' in value)) return 'en';
  return typeof value.language === 'string' ? value.language : 'en';
}

export default function LiteraturePage() {
  const { i18n, t } = useTranslation();
  const { isEnabled } = usePlugins();
  const controller = useLiteratureSearch({ t });
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { setters, state } = controller;
  useKeyboardScroll(scrollContainerRef, {
    modalOpen: Boolean(state.preview || state.aiProposal),
  });

  if (!isEnabled('resources')) {
    return (
      <main className="literature-page">
        <div className="literature-empty">
          <LibraryBig size={36} />
          <h1>{t('literature.disabled.title')}</h1>
          <p>{t('literature.disabled.help')}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="literature-page">
      <AppHeader icon={LibraryBig} title={t('literature.title')}>
        <nav aria-label={t('literature.tabs_label')} className="literature-page__tabs">
          <button
            className={state.tab === 'search' ? 'is-active' : ''}
            onClick={() => { setters.setTab('search'); }}
            type="button"
          >
            <Search size={15} /> {t('literature.tabs.search')}
          </button>
          <button
            className={state.tab === 'reviews' ? 'is-active' : ''}
            onClick={() => { setters.setTab('reviews'); }}
            type="button"
          >
            <BookOpenCheck size={15} /> {t('literature.tabs.reviews')}
          </button>
        </nav>
      </AppHeader>
      <div className="literature-page__scroll" ref={scrollContainerRef}>
        <div className="literature-page__content">
          {state.tab === 'reviews' ? (
            <ReviewWorkspace
              currentSearch={state.searchResult}
              selectedWorks={state.selectedWorks}
              t={t}
            />
          ) : (
            <SearchWorkspace
              controller={controller}
              language={translationLanguage(i18n)}
              t={t}
            />
          )}
        </div>
      </div>
    </main>
  );
}
