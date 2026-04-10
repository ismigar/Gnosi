# Directiva: Sobirania de Dades a n8n (Substitució de Notion)

> ID: 2026-04-07
> Associated Script: N/A (Configuració n8n)
> Last Update: 2026-04-07
> Status: ACTIVE

---

## 1. Objectiu

Assegurar que tota la lògica d'automatització a n8n depèn exclusivament de l'ecosistema local de Gnosi (Digital Brain), eliminant progressivament els nodes de Notion a favor de crides a l'API pròpia i gestió de fitxers Markdown al Vault.

## 2. Workflows i Origen de Dades

### Sincronització de Publicacions (Gnosi -> Temenos)
- **Origen:** El vault de Gnosi actua com a "Base de Dades" principal.
- **Trigger:** Webhook de Gnosi (`vault-update`) enviat des del backend quan es desa una nota.
- **Accions:**
    - Llegir el fitxer MD directament via API de Gnosi.
    - Processar metadades (YAML) per determinar publicació a Drupal (Temenos).
    - **Llegat:** Si encara calen dades de Notion per a notes històriques, l'importador de Gnosi s'encarrega d'injectar-les primer al Vault.

### Social Media Poster
- **Trigger:** Webhook des del backend de Gnosi.
- **Dades:** Tota la informació dels posts prové del Vault local de Gnosi, no de Notion.

## 3. Guia de Substitució de Nodes

### Triggers (Polling Notion -> Push Webhook Gnosi)
En lloc de fer polling cada minut a Notion, utilitzem l'esdeveniment de "Desar" a Gnosi.
- **Endpoint:** `POST http://n8n:5678/webhook/vault-update`
- **Payload:** ID de la pàgina, carpeta i contingut.

### Accions (Node Notion -> Node HTTP Request)
Totes les operacions d'escriptura i lectura es fan contra el backend de Gnosi (`host.docker.internal:5002`):
- `POST /api/vault/pages`: Crear nova pàgina/nota.
- `PATCH /api/vault/pages/{id}`: Actualitzar contingut o metadades.
- `GET /api/vault/pages`: Llistar o cercar en el vault.

## 4. Restriccions i Seguretat

- **UUIDs:** Mantenir la consistència entre els IDs de Gnosi i les referències a Drupal (Temenos) per evitar duplicitats.
- **Depuració:** Tots els logs de n8n han d'utilitzar terminologia de "Gnosi/Vault". Qualsevol referència a "Notion" fora dels nodes de migració s'ha de considerar un error de configuració.

## 5. Protocol d'Aprenentatge

| Data | Error Detectat | Causa Arrel | Solució/Patch Aplicat |
| --- | --- | --- | --- |
| 07/04/2026 | Polling excessiu | Dependència de NotionTriggers | Migració completa a Webhooks basats en esdeveniments de Gnosi. |
| ... | ... | ... | ... |
