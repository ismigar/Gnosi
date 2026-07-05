# DIRECTIVE: CONTACTS_SYNC

> ID: CONTACTS_SYNC_001
> Associated Script: [N/A - Full feature implementation]
> Last Update: 10/04/2026
> Status: ACTIVE

---

## 1. Objectives and Scope

- **Main Objective:** Implementar un sistema de contactos bidireccional sincronizado con Google Contacts y extensible a Apple iCloud, Outlook y LinkedIn.
- **Success Criteria:** Un contacto creado/editado en Gnosi se sincroniza con Google y viceversa. El frontend permite CRUD completo y visualización del estado de sincronización.

## 2. Input/Output (I/O) Specifications

### Inputs

- **User Actions:** Crear, editar, eliminar, buscar contactos desde el frontend.
- **Google OAuth:** Credenciales OAuth2 almacenadas en `integrations.json`.
- **Environment Variables (.env_shared):**
    - `GOOGLE_OAUTH_CLIENT_ID`
    - `GOOGLE_OAUTH_CLIENT_SECRET`
    - `GOOGLE_OAUTH_REDIRECT_URI`

### Outputs

- **Modelo Contact:** SQLAlchemy en `backend/models/contact.py`
- **API REST:** CRUD en `/api/contacts` + sync en `/api/contacts/sync`
- **Frontend:** Página `/contacts` con lista, detalle, formulario

## 3. Logical Flow (Algorithm)

### Modelo de Datos

1. **Contact (SQLAlchemy):**
    - `id`: UUID primary key
    - `workspace_id`: FK a Workspace
    - `type`: enum (`personal` / `b2b`)
    - `name`: string
    - `email`: string (único por workspace)
    - `phone`: string opcional
    - `company`: string (B2B)
    - `job_title`: string (B2B)
    - `address`: string opcional
    - `notes`: text opcional
    - `google_resource_name`: string (Google resource name, nullable)
    - `last_synced_at`: datetime
    - `source`: enum (`local` / `google`)
    - `tags`: JSON array

### Sincronización Bidireccional

1. **Gnosi → Google:**
    - Crear/actualizar contacto en People API
    - Guardar `google_resource_name` devuelto
    - Actualizar `last_synced_at`

2. **Google → Gnosi:**
    - Listar contactos desde People API
    - Para cada contacto Google sin `google_resource_name` en Gnosi, crear nuevo
    - Para cada contacto con `google_resource_name`, actualizar si `updated_at` Google > `last_synced_at`

3. **Resolución de conflictos:** `last-write-wins` basado en `last_synced_at`

### API Endpoints

| Método | Path | Descripción |
|--------|------|-------------|
| GET | `/api/contacts` | Lista (filtros: `?type=personal&search=term`) |
| GET | `/api/contacts/:id` | Ver uno |
| POST | `/api/contacts` | Crear |
| PUT | `/api/contacts/:id` | Actualizar |
| DELETE | `/api/contacts/:id` | Eliminar |
| POST | `/api/contacts/sync` | Sincronizar Google→Gnosi |
| GET | `/api/contacts/sync/status` | Estado último sync |

## 4. Tools and Libraries

- **Backend:** Flask, SQLAlchemy, Pydantic, google-api-python-client, google-auth-oauthlib
- **Frontend:** React, React Router, API hooks existentes

## 5. Restrictions and Edge Cases

- **Google OAuth no integrado:** El código existe en `google_auth_routes.py` pero NO se importa en `app.py`. Esta PR debe integrar el flujo OAuth real.
- **User hardcoded:** El frontend usa `userId = 'ismael-legacy'`. contacts_routes debe usar workspace del header `X-Workspace-ID`.
- **Contactos duplicados:** Si el mismo email existe en Google y Gnosi, usar `google_resource_name` como clave de merge.
- **MERGE, NO mirror — el pull NUNCA debe vaciar un campo local (CRÍTICO, data loss):**
  El pull (`sync_remote_to_gnosi`) es un MERGE, no un espejo. Un campo remoto
  vacío/ausente NO puede sobreescribir un valor que el usuario introdujo en Gnosi.
  Razón: el sync es bidireccional y `sync_gnosi_to_remote` empuja local→remoto; si
  el pull vaciara el campo a `""`, el push posterior propagaría el `""` al remoto y
  el dato se perdería en ambos lados (pérdida silenciosa).
  - **Trampa (verificada 2026-07-05):** los DOS parsers (`parse_google_contact_to_dict`
    y `CardDAVContactsProvider.parse_to_internal`) devuelven los campos ausentes como
    cadena vacía `""` (clave PRESENTE), no ausente. Por eso `parsed.get(k, existing.X)`
    (default por clave ausente) NO sirve: la clave está presente con `""` y el default
    nunca se activa. Único caso realmente ausente: `photo_url` en CardDAV (el parser ni
    incluye la clave → `None`).
  - **Fix correcto:** `parsed.get(k) or existing.X` en TODOS los campos escalares
    (name, email, phone, company, job_title, address, notes, photo_url). Agnóstico al
    parser: preserva el local tanto si el remoto viene `""` como `None`. Cuando el
    remoto SÍ trae valor, gana el remoto (mantiene el last-write-wins de facto).
  - **Contrapartida conocida:** con `or existing.X` no se puede BORRAR un campo desde
    el remoto (resucita del local en el siguiente sync). Es el mal menor frente a la
    pérdida de datos. Para distinguir "borrado" de "ausente" haría falta un baseline
    por contacto (snapshot del último sync) → three-way merge. Pendiente si se necesita
    propagar borrados.
  - **NO implementado aún:** la §3 dice "actualizar si `updated_at` Google > `last_synced_at`",
    pero el código actualiza en cada sync sin comparar timestamps (y CardDAV no expone
    `updated_at` en el dict). El gating por timestamp reduciría escrituras pero NO basta
    por sí solo para evitar el data loss (si el remoto es más nuevo pero trae el campo
    vacío, seguiría machacando) → el fix a nivel de campo (`or existing.X`) es el que
    corrige el bug. Tests de regresión: `backend/tests/test_contacts_sync_merge.py`.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution |
|------|----------------|------------|----------|
| 10/04 | Google OAuth routes not imported | `google_auth_routes.py` no se importa en `app.py` | Añadir import al final de `app.py` |
| 10/04 | User hardcoded in frontend | `use-api.js` usa `'ismael-legacy'` | Contacts debe usar header `X-Workspace-ID` del contexto |
| 05/07 | El pull vaciaba phone/company/address/notes locales a `""` en cada sync (data loss) | `updated_data[k] = parsed.get(k)` + ambos parsers devuelven `""` para campos ausentes (clave presente) → machaca el valor local. El fallback `parsed.get(k, existing.X)` no basta (default por clave ausente, nunca se activa) | `parsed.get(k) or existing.X` en los 8 campos escalares (Google + CardDAV). Regresión reproducida E2E y cubierta por `test_contacts_sync_merge.py` (6 tests) |

## 7. Pre-Execution Checklist

- [ ] Credenciales Google OAuth configuradas en `integrations.json`
- [ ] Tabla `contacts` creada en SQLite (migración automática SQLAlchemy)
- [ ] Dependencias instaladas (`pip install -r requirements.txt`)
- [ ] Scopes OAuth: `https://www.googleapis.com/auth/contacts`

## 8. Post-Execution Checklist

- [ ] `npm run build` pasa en frontend
- [ ] `docker-compose up -d` levanta backend sin errores
- [ ] Crear contacto desde UI → aparece en Google Contacts
- [ ] Editar contacto en Google → aparece actualizado en Gnosi

## 9. Additional Notes

- **Extensibilidad:** Usar patrón `contacts_service.py` con métodos `list_*`, `create_*`, `update_*` para facilitar añadir Apple/Outlook en el futuro.
- **Google People API endpoint:** `https://people.googleapis.com/v1/people/me/connections`
- **Integrations JSON structure:**
```json
{
  "calendars": [...],
  "contacts": [
    {
      "provider": "google",
      "auth_type": "oauth2",
      "email": "user@gmail.com",
      "client_id": "...",
      "client_secret": "...",
      "token": "...",
      "refresh_token": "..."
    }
  ]
}
```
