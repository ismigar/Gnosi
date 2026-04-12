# Directiva: Correcció d'Errors en l'Eliminació de Cites al Calendari

## Context
S'ha detectat un error visual on les notificacions d'error (toasts) apareixen i desapareixen ràpidament sense deixar rastre a la consola quan s'intenta eliminar una cita. Això sol ser causat per:
1. Claus de traducció inexistents (`event_deleted`, `event_delete_error`).
2. Intents d'eliminar recursos externs (ex. Google Calendar) des d'endpoints que només accepten fitxers locals (.md).

## Protocols de Resolució

### 1. Traduccions Robustes
- Totes les operacions de CRUD han de tenir les seves claus de traducció definides als fitxers JSON de cada idioma.
- Mai s'ha de confiar al 100% en el text per defecte de la funció `t()` si s'espera una notificació d'error crítica.

### 2. Validació d'Origen (Local vs Extern)
- Abans de cridar `axios.delete`, cal verificar si l'objecte té un origen local (`source === 'Gnosi'` o similar).
- Si la cita és externa, el botó d'eliminació hauria d'estar deshabilitat o mostrar un missatge explicatiu indicant que s'ha de gestionar des de la plataforma d'origen.

### 3. Gestió d'Errors
- El bloc `catch` ha d'assegurar-se de registrar l'error complet a la consola abans de llançar el *toast*.
- Si el component es pot "desmuntar" durant l'eliminació, les operacions de tancament han d'esperar que la promesa de l'API s'hagi resolt.

## Historial de Canvis
- **2026-04-10**: Corregit l'error de claus de traducció faltants i afegida validació bàsica d'origen.
