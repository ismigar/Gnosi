# Directive: Sistema d'Etiquetes per a Correus

## Objectiu
Implementar un sistema de tagging local (Gnosi-native) pels correus electrònics, independent del proveïdor (Gmail/IMAP/Microsoft). Les etiquetes es guarden a la DB del vault.

## Arquitectura

### Models (vault DB via `get_db`)
- `MailTag`: id (uuid), name, color (hex, e.g. `#3b82f6`), created_at
- `MailMessageTag`: message_id (PK), tag_id (FK → MailTag, ondelete CASCADE) (PK), account_email, subject, sender, date_str
  - Cached metadata per mostrar missatges etiquetats sense tornar a cridar Gmail/IMAP

### Endpoints `/api/mail/tags`
- `GET /api/mail/tags` → llista totes les etiquetes
- `POST /api/mail/tags` → crea etiqueta `{name, color}`
- `PUT /api/mail/tags/{id}` → actualitza `{name?, color?}`
- `DELETE /api/mail/tags/{id}` → elimina (cascada a MailMessageTag)
- `GET /api/mail/messages/{id}/tags` → retorna `[tag_id, ...]`
- `POST /api/mail/messages/{id}/tags` → `{tag_ids: [], metadata: {...}}` reemplaça totes les etiquetes del missatge
- `GET /api/mail/tags/{tag_id}/messages` → retorna missatges etiquetats (amb metadata cached)
- `POST /api/mail/tags/messages/batch` → `{message_ids: []}` → `{message_id: [tag_id, ...]}`

### Frontend
- `hooks/useMailTags.js` → CRUD + assignació
- `components/Mail/MailTagPicker.jsx` → dropdown selecció amb creació inline
- `MailSidebar.jsx` → secció "Etiquetes" amb filtre per tag
- `MailList.jsx` → pills de color sobre els items + prop `activeTagId`
- `MailViewer.jsx` → botó Tag a l'action bar, mostra etiquetes actives

## Restriccions
- Tags són locals a Gnosi, NO es sincronitzen amb Gmail labels ni IMAP flags
- La taula `mail_message_tags` guarda metadata cacheada (subject, sender, date) per al filtre per tag
- El color és un string hex (#RRGGBB)
- Màxim 20 etiquetes per compte (límit UI, no DB)
- Un missatge pot tenir múltiples etiquetes
- `POST /messages/{id}/tags` fa un replace complet (no un merge)
