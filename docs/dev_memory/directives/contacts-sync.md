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

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution |
|------|----------------|------------|----------|
| 10/04 | Google OAuth routes not imported | `google_auth_routes.py` no se importa en `app.py` | Añadir import al final de `app.py` |
| 10/04 | User hardcoded in frontend | `use-api.js` usa `'ismael-legacy'` | Contacts debe usar header `X-Workspace-ID` del contexto |

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
