import { format } from 'date-fns';
import { ca } from 'date-fns/locale';
import {
  AlertTriangle,
  Building,
  CalendarCheck,
  Clock,
  Info,
  Mail,
  MapPin,
  Paperclip,
  Phone,
  Sparkles,
  SquareCheckBig,
  Users,
  UserPlus,
} from 'lucide-react';

import type { MailViewerController } from './useMailViewerController';
import type { MailAnalysisEvidence } from './mailViewerTypes';


function EvidenceList({
  icon: Icon,
  items,
  title,
}: {
  readonly icon: typeof Paperclip;
  readonly items: readonly MailAnalysisEvidence[];
  readonly title: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-4">
      <h4 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">
        <Icon size={14} /> {title}
      </h4>
      <ul className="space-y-2 text-sm text-[var(--text-primary)]">
        {items.map((item, index) => (
          <li key={`${item.kind}-${item.value}-${String(index)}`}>
            <div>{item.value}</div>
            <div className="text-[11px] text-[var(--text-tertiary)]">
              {Math.round(item.confidence * 100)}% · {item.origin}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}


export function MailSmartSuggestions({ controller }: { readonly controller: MailViewerController }) {
  const entities = controller.extractedEntities;
  const { t } = controller;
  const statusCopy = {
    invalid_response: t(
      'mail.smart_analysis_invalid_response',
      'The analysis service returned an invalid response. You can try again.',
    ),
    no_entities: t(
      'mail.smart_analysis_no_entities',
      'No calendar events or contacts were found in this message.',
    ),
    not_configured: t(
      'mail.smart_analysis_not_configured',
      'Smart analysis is not configured. Add an AI provider in Settings.',
    ),
    temporarily_unavailable: t(
      'mail.smart_analysis_temporarily_unavailable',
      'Smart analysis is temporarily unavailable. You can try again.',
    ),
  } as const;
  if (controller.analysisStatus in statusCopy) {
    const retryable = controller.analysisStatus === 'invalid_response'
      || controller.analysisStatus === 'temporarily_unavailable';
    const StatusIcon = retryable
      ? AlertTriangle
      : controller.analysisStatus === 'no_entities' ? Sparkles : Info;
    return (
      <div className="flex items-center justify-between gap-4 bg-[var(--bg-secondary)]/70 border border-[var(--border-primary)] rounded-2xl px-5 py-4 mb-6" data-mail-analysis-status={controller.analysisStatus}>
        <div className="flex items-center gap-3 text-sm text-[var(--text-secondary)]">
          <StatusIcon aria-hidden="true" className="shrink-0" size={17} />
          <span>{statusCopy[controller.analysisStatus as keyof typeof statusCopy]}</span>
        </div>
        {retryable && (
          <button className="shrink-0 px-3 py-1.5 rounded-lg bg-[var(--sidebar-item-active)] text-[var(--gnosi-blue)] text-xs font-bold hover:opacity-80" onClick={controller.analyzeMessage} type="button">
            {t('common.retry', 'Try again')}
          </button>
        )}
      </div>
    );
  }
  if (!entities || (entities.events.length === 0 && entities.contacts.length === 0
    && !entities.localAnalysis)) return null;
  const local = entities.localAnalysis;
  const preservedResult = entities.resultSource === 'previous_valid';
  const locallyProduced = entities.resultSource === 'local';
  return (
    <div className="bg-[var(--bg-secondary)]/50 border border-[var(--border-primary)] rounded-3xl p-8 mb-12 animate-in fade-in slide-in-from-top-4 duration-500 backdrop-blur-sm" data-mail-analysis-source={entities.resultSource ?? undefined} data-mail-analysis-status={controller.analysisStatus}>
      {(locallyProduced || preservedResult) && (
        <div className="flex items-center justify-between gap-4 border border-[var(--border-primary)] bg-[var(--bg-primary)] rounded-2xl px-4 py-3 mb-6" data-mail-analysis-provenance={preservedResult ? 'previous' : 'local'}>
          <div className="flex items-center gap-3 text-sm text-[var(--text-secondary)]">
            {preservedResult
              ? <Clock aria-hidden="true" className="shrink-0 text-amber-500" size={17} />
              : <Info aria-hidden="true" className="shrink-0 text-[var(--gnosi-blue)]" size={17} />}
            <span>{preservedResult ? t(
              'mail.smart_analysis_previous_result',
              'Showing the previous valid analysis for this exact message. Current local evidence remains visible below.',
            ) : t(
              'mail.smart_analysis_local_results',
              'Analyzed locally from explicit message content. Review suggestions before adding them.',
            )}</span>
          </div>
          <button className="shrink-0 px-3 py-1.5 rounded-lg bg-[var(--sidebar-item-active)] text-[var(--gnosi-blue)] text-xs font-bold hover:opacity-80" onClick={controller.analyzeMessage} type="button">
            {t('mail.smart_analysis_retry_online', 'Try online analysis')}
          </button>
        </div>
      )}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center shadow-lg"><Sparkles size={20} /></div>
        <h3 className="text-xl font-bold text-[var(--text-primary)]">{t('mail.smart_suggestions', 'Smart suggestions')}</h3>
      </div>
      {local && (
        <div className="mb-6 space-y-4" data-mail-local-analysis="true">
          {local.summary && (
            <div className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-4">
              <h4 className="mb-2 text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">
                {t('mail.local_analysis_summary', 'Extractive summary')}
              </h4>
              <p className="text-sm text-[var(--text-primary)]">{local.summary.value}</p>
              <div className="mt-2 text-[11px] text-[var(--text-tertiary)]">
                {Math.round(local.summary.confidence * 100)}% · {local.summary.origin}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <EvidenceList icon={Users} items={local.participants} title={t('mail.local_analysis_participants', 'Participants')} />
            <EvidenceList icon={Paperclip} items={local.attachments} title={t('mail.local_analysis_attachments', 'Attachments')} />
            <EvidenceList icon={SquareCheckBig} items={local.tasks} title={t('mail.local_analysis_tasks', 'Explicit tasks')} />
            <EvidenceList icon={CalendarCheck} items={local.dates} title={t('mail.local_analysis_dates', 'Explicit dates')} />
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {entities.events.length > 0 && (
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest flex items-center gap-2"><CalendarCheck size={14} /> {t('calendar.title', 'Calendar')}</h4>
            {entities.events.map((event) => (
              <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow group" key={`${event.title}-${event.start}`}>
                <div className="font-bold text-[var(--text-primary)] mb-2 group-hover:text-[var(--gnosi-blue)] transition-colors">{event.title}</div>
                <div className="text-xs text-[var(--text-secondary)] space-y-1.5 mb-4">
                  <div className="flex items-center gap-2"><Clock className="opacity-60" size={12} />{event.start ? format(new Date(event.start), 'd MMM, HH:mm', { locale: ca }) : t('mail.event_date_unspecified', 'Date not specified')}</div>
                  {event.location && <div className="flex items-center gap-2"><MapPin className="opacity-60" size={12} />{event.location}</div>}
                </div>
                <button className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[var(--sidebar-item-active)] hover:bg-[var(--gnosi-blue)] text-[var(--gnosi-blue)] hover:text-white rounded-xl text-xs font-bold transition-all" onClick={() => { void controller.openCalendarPicker(event); }} type="button"><CalendarCheck size={14} /> {t('mail.add_to_calendar_button', 'Add to calendar')}</button>
              </div>
            ))}
          </div>
        )}
        {entities.contacts.length > 0 && (
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest flex items-center gap-2"><UserPlus size={14} /> {t('contacts.title', 'Contacts')}</h4>
            {entities.contacts.map((contact) => (
              <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow group" key={`${contact.email}-${contact.name}`}>
                <div className="font-bold text-[var(--text-primary)] mb-2 group-hover:text-[var(--gnosi-blue)] transition-colors">{contact.name}</div>
                <div className="text-xs text-[var(--text-secondary)] space-y-1.5 mb-4">
                  {contact.email && <div className="flex items-center gap-2"><Mail className="opacity-60" size={12} />{contact.email}</div>}
                  {contact.phone && <div className="flex items-center gap-2"><Phone className="opacity-60" size={12} />{contact.phone}</div>}
                  {contact.company && <div className="flex items-center gap-2"><Building className="opacity-60" size={12} />{contact.company}</div>}
                </div>
                <button className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[var(--sidebar-item-active)] hover:bg-[var(--status-success)] text-[var(--gnosi-blue)] hover:text-white rounded-xl text-xs font-bold transition-all" onClick={() => { void controller.addExtractedContact(contact); }} type="button"><UserPlus size={14} /> {t('mail.add_to_contacts_button', 'Add to contacts')}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
