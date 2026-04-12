# Directiva: Protocol de Migració de Dades (Esquema Gnosi)

Aquesta directiva regula el procés de migració de dades des de sistemes d'origen externs cap a l'arquitectura descentralitzada del Gnosi (Vault/Drupal).

## Protocol de Migració

1. **Extracció d'Esquema**: Abans de migrar dades, s'ha d'extreure l'esquema del sistema original per mapejar tipus de dades (Select, Multi-select, Relation, etc.) als tipus del Vault.
2. **Relacions**: Les relacions entre taules s'han de traduir a referències per UUID en els fitxers Markdown del Vault o entitats a Drupal.
3. **Idempotència**: Els scripts de migració han de poder-se executar múltiples vegades sense duplicar registres (ús de `source_id` com a clau única).

## Mapeig de Tipus de Dada

| Sistema Origen | Gnosi Type | Notes |
|----------------|--------------------|-------|
| title          | text (primary)     | Nom de la pàgina/fitxer |
| select         | select             | Mantenir opcions |
| multi_select   | multi_select       | |
| relation       | relation           | Mapejar a table_id + record_uuid (usant source_id) |

## Metadades Neutres
- `source_id`: Identificador únic del sistema d'origen.
- `area_id`: Referència jeràrquica a l'àrea pare.
- `database_table_id`: Identificador de la taula destí (p. ex. `projects`).

## Restriccions i Edge Cases
- **Fitxers/Imatges**: S'han de descarregar i guardar localment en una carpeta `/media` o `Assets/Covers` referenciada pel Markdown.
- **Neteja de Marques**: No s'ha de fer servir el nom de cap proveïdor de programari en les etiquetes o camps de dades per evitar dependències de marca.

## Històric de Lliçons Apreses
- **Emoji en noms**: Els sistemes d'origen poden tenir emojis en els noms de les columnes; s'han de normalitzar o gestionar durant la migració.
