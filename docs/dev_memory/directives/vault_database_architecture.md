# Directiva: Arquitectura de Bases de Dades al Vault (Digital Brain)

Aquesta directiva defineix l'arquitectura i el protocol per gestionar bases de dades estructurades dins del Vault, superant les limitacions de Notion mitjançant un desacoblament entre Dades, Lògica i Presentació.

## Arquitectura de 4 Capes

### 1. Database (Espai/App)
Contenidor lògic d'alt nivell que agrupa taules relacionades per un context (ex: "Projectes", "Comptabilitat").
- **Estructura:**
  ```json
  {
    "id": "uuid",
    "name": "Comptabilitat",
    "icon": "💰",
    "tables": ["table_id_1", "table_id_2"]
  }
  ```

### 2. Table (Col·lecció / Esquema)
Defineix les propietats i el tipus de dades. És el "mestre" de les pàgines que conté.
- **Estructura:**
  ```json
  {
    "id": "uuid",
    "database_id": "uuid",
    "name": "Moviments",
    "properties": {
      "Import": "number",
      "Data": "date",
      "Categoria": "select"
    }
  }
  ```
- **Herència:** Qualsevol pàgina del Vault que estigui associada a aquesta `table_id` heretarà aquestes propietats a la seva metadada (Frontmatter).

### 3. View (Vista / Query)
Configuració específica de visualització d'una taula.
- **Estructura:**
  ```json
  {
    "id": "uuid",
    "table_id": "uuid",
    "name": "Ingressos Mensuals",
    "type": "table | kanban | gallery",
    "filters": [
      { "property": "Import", "operator": ">", "value": 0 }
    ],
    "sorts": [
      { "property": "Data", "direction": "desc" }
    ],
    "visible_properties": ["Import", "Data"]
  }
  ```

### 4. Record (Pàgina / Dades)
Les dades reals són Pàgines Markdown amb metadades enriquides.
- **Vincle:** Es guarden amb una propietat `database_table_id: uuid`.
- **Identificador Únic:** S'utilitza sempre la clau `id` per identificar el registre, unificant `source_id` o `notion_id`.
- **Flexibilitat:** Al ser pàgines, poden contenir text lliure, imatges i blocs a part de les propietats estructurades.

## Protocols de Desenvolupament

- **Single Source of Truth:** La configuració de les DBs (`vault_db_registry.json`) es guarda al directori del Vault (o a la configuració del sistema).
- **Idempotència:** Quan s'afegeix una propietat a una taula, no cal modificar immediatament totes les pàgines. L'editor ha de ser capaç de detectar la falta de la propietat i oferir un valor per defecte.
- **Desacoblament UI:** El component `VaultTable` no ha de saber res de fitxers; només ha de rebre una llista d'objectes (registres) i un esquema de vista.

## Restriccions i Edge Cases
- **Borrats:** Si s'esborra una Vista, no passa res a les dades. Si s'esborra una Taula, s'ha de demanar confirmació si es volen "desvincular" les pàgines o esborrar-les.
- **Canvis de Tipus:** Canviar un camp de "Text" a "Número" pot requerir una validació o casting de dades. Per ara, prioritzarem la flexibilitat.
