# Directiva: Gestió d'Integracions i Persistència (Gnosi)

## Context del Problema
Es van detectar pèrdues de dades en afegir comptes de Google a causa d'una "race condition" entre el sistema d'Auto-save del frontend i el Callback d'OAuth del backend. La web sobreescrivia la configuració nova amb l'estat local encara no actualitzat.

## Regles d'Or (MANDATORI)

### 1. Bloqueig d'Auto-save (Frontend)
Qualsevol modal o component que gestioni la configuració d'integracions **HA DE** implementar un mecanisme de bloqueig inicial.
- **Implementació:** Utilitzar una referència (`integrationsLoadedRef`) que s'activi només després que el primer `GET /api/integrations` hagi finalitzat amb èxit.
- **Acció:** Si `loaded` és fals, qualsevol intent de guardat (auto-save) ha de ser abortat immediatament per evitar sobreescriure dades del servidor amb estats locals "buits".

### 2. Identificadors Únics (IDs)
Per a les integracions de Google, l'ID ha de ser consistent a totes les llistes:
- **Format:** `google_{email}` (Exemple: `google_usuari@gmail.com`).
- **Ús:** S'ha de fer servir aquest ID tant a `mail_accounts`, `calendars` com a `contacts` per permetre el "deep merge" correcte.

### 3. Lògica de Guardat (Backend)
L' `IntegrationManager` no ha de substituir llistes senceres si no és estrictament necessari.
- **Mètode:** Utilitzar `bulk_update` per fusionar elements per ID. Si un element amb el mateix ID ja existeix, s'ha d'actualitzar; si no, s'ha d'afegir a la llista existent.

### 4. Entorn de Logs (Docker)
Atès que el backend corre principalment en FastAPI (Port 5002) dins de Docker:
- **Prioritat:** Revisar sempre els logs de Docker (`docker logs gnosi_backend`) per errors de rutes.
- **Alerta:** No barrejar rutes de Flask i FastAPI; assegurar-se que el frontend apunta al port correcte (5002 per defecte en dev).

---
*Aquesta directiva ha estat creada després de la incidència de persistència de Gmail del 22 d'abril de 2026.*
