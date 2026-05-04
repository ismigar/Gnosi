# Directiva: Funcionalitat d'Amagar Cites (Privacy/Filter)

## Objectiu
Permetre que l'usuari amagui cites del calendari (tant de Notion com externes de Gmail) sense eliminar-les de la font original.

## Components a Modificar

### 1. Backend: Model de Dades
- Crear `backend/models/calendar.py` amb el model `HiddenEvent`.
- Taula: `hidden_events`
- Camps: `event_id` (String, PK), `user_id` (String, opcional), `hidden_at` (DateTime).

### 2. Backend: API
- **Filtre Global:** Modificar `_get_pages_snapshot` (`vault_routes.py`) i `get_events` (`calendar_routes.py`) per carregar la llista d'IDs ocults i descartar-los.
- **Nous Endpoints:**
    - `POST /api/calendar/events/{event_id}/hide`: Afegeix un ID a la llista d'ocults.
    - `POST /api/calendar/events/{event_id}/unhide`: Elimina un ID de la llista d'ocults.

### 3. Frontend: Interfície
- **Menú Contextual:** Afegir l'opció "Amagar" a `CalendarContextMenu.jsx`.
- **Lògica de Filtre:** Assegurar que el calendari es refresca després d'amagar una cita.

## Restriccions
- Les cites externes (Gmail) s'han d'amagar només localment a Gnosi.
- No s'ha de modificar la cita a Gmail ni a Notion per defecte, només l'estat local a `gnosi.db`.

## QA
- Verificar que una cita de Gmail amagada desapareix de Gnosi però segueix a Google Calendar.
- Verificar que una cita de Notion amagada desapareix de Gnosi però segueix a Notion.
- Verificar que es pot revertir l'ocultació (opcionalment mitjançant una vista de "Paperera" o "Ocults").
