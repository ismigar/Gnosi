import React from 'react';
import { CheckCircle2, Download, Rocket, Sparkles, Wrench, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { RELEASES, RELEASE_NOTE_SECTIONS } from '../lib/releaseNotes';

const SECTION_ICONS = {
  highlights: Sparkles,
  improvements: Rocket,
  fixes: Wrench,
};

const PUBLIC_RELEASES_URL = 'https://github.com/ismigar/Gnosi/releases/tag';

export function ReleaseNotesDialog({ open, onClose, initialVersion }) {
  const { t, i18n } = useTranslation();

  if (!open) return null;

  const selectedRelease = RELEASES.find((release) => release.version === initialVersion);
  const orderedReleases = selectedRelease
    ? [selectedRelease, ...RELEASES.filter((release) => release.version !== initialVersion)]
    : RELEASES;

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="flex max-h-[min(48rem,calc(100vh-2rem))] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="release-notes-title"
      >
        <header className="flex items-start gap-4 border-b border-[var(--border-primary)] px-6 py-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-primary)] text-white">
            <Sparkles size={21} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="release-notes-title" className="text-lg font-bold">
              {t('release_notes.title')}
            </h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {t('release_notes.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
            aria-label={t('release_notes.close')}
          >
            <X size={19} aria-hidden="true" />
          </button>
        </header>

        <div className="overflow-y-auto px-6 py-5">
          <div className="space-y-8">
            {orderedReleases.map((release) => (
              <article key={release.version} className="relative pl-5">
                <span className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-[var(--accent-primary)]" />
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-bold">Gnosi {release.version}</h3>
                  <span className="rounded-full border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    {t(`release_notes.channel_${release.channel}`)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <time className="text-xs text-[var(--text-tertiary)]" dateTime={release.date}>
                    {t('release_notes.published_on', {
                      date: new Intl.DateTimeFormat(i18n.resolvedLanguage || 'en', { dateStyle: 'long' })
                        .format(new Date(`${release.date}T00:00:00`)),
                    })}
                  </time>
                  <a
                    href={`${PUBLIC_RELEASES_URL}/v${release.version}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--accent-primary)] hover:underline"
                  >
                    <Download size={14} aria-hidden="true" />
                    {t('release_notes.download_version')}
                  </a>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  {RELEASE_NOTE_SECTIONS.map((section) => {
                    const entries = release.sections[section] || [];
                    if (entries.length === 0) return null;
                    const Icon = SECTION_ICONS[section] || CheckCircle2;
                    return (
                      <section key={section} className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
                        <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                          <Icon size={15} aria-hidden="true" />
                          {t(`release_notes.section_${section}`)}
                        </h4>
                        <ul className="mt-3 space-y-2 text-sm leading-5">
                          {entries.map((key) => <li key={key}>• {t(key)}</li>)}
                        </ul>
                      </section>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
