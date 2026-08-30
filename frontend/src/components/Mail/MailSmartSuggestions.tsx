import { format } from 'date-fns';
import { ca } from 'date-fns/locale';
import {
  Building,
  CalendarCheck,
  Clock,
  Mail,
  MapPin,
  Phone,
  Sparkles,
  UserPlus,
} from 'lucide-react';

import type { MailViewerController } from './useMailViewerController';


export function MailSmartSuggestions({ controller }: { readonly controller: MailViewerController }) {
  const entities = controller.extractedEntities;
  if (!entities || (entities.events.length === 0 && entities.contacts.length === 0)) return null;
  const { t } = controller;
  return (
    <div className="bg-[var(--bg-secondary)]/50 border border-[var(--border-primary)] rounded-3xl p-8 mb-12 animate-in fade-in slide-in-from-top-4 duration-500 backdrop-blur-sm">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center shadow-lg"><Sparkles size={20} /></div>
        <h3 className="text-xl font-bold text-[var(--text-primary)]">{t('mail.smart_suggestions', 'Smart suggestions')}</h3>
      </div>
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
