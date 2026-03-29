# Directiva: Integració de Mail al Vault

Aquesta directiva documenta el protocol per sincronitzar correus electrònics com a notes del Vault i garantir la seva visibilitat en les vistes de taula.

## Context i Aprenentatges
Durant la implementació inicial, es van identificar diversos problemes de visibilitat "fantasma" (fitxers existents però taules buides).

### 1. Requisit de Metadades (Critical)
Perquè una nota aparegui en una taula del Vault, **HA DE CONTIENIR** el camp `database_table_id` al frontmatter coincident amb l'ID de la taula al `vault_db_registry.json`.
- **Error**: Generar notes només amb camps de dades (sender, date).
- **Solució**: Incloure sempre `database_table_id: mail` (o el que correspongui).

### 2. Robustesa del YAML Frontmatter
Els camps de correu (com `sender` o `subject`) sovint contenen caràcters especials, cometes dobles o símbols que trenquen el parseig manual de strings.
- **Error**: Ús de f-strings per generar el frontmatter: `sender: "{sender}"`. Això falla si `sender` conté una cometa.
- **Solució**: Utilitzar sempre una llibreria de generació de YAML (com `yaml.dump` en Python) per garantir l'escapament correcte.

### 3. Conflictes de Configuració (Docker/Monorepo)
En entorns amb múltiples carpetes `config`, Python pot importar la versió incorrecta de `paths_config.py` o `env_config.py` si no s'utilitzen imports relatius o rutes absolutes del monorepo.
- **Error**: `from config.paths_config import get_paths` pot col·lidir amb una carpeta `config` a l'arrel.
- **Solució**: Utilitzar imports relatius dins del propi paquet de configuració (ex: `from .paths_config import ...`) i assegurar que el `PYTHONPATH` està ben definit al contenidor.

## Protocol d'Execució
1. **Sincronització**: El servei ha de verificar la ruta del Vault usant la configuració del backend.
2. **Generació**: Aplicar `yaml.dump` per a totes les metadades.
3. **Verificació**: Un cop generats els fitxers, realitzar una consulta a l'API del Vault per confirmar que els registres són retornats pel motor de dades.

> [!IMPORTANT]
> Si la taula es mostra buida malgrat que els fitxers existeixen, el primer que cal comprovar és la validesa del YAML al frontmatter i la presència del `database_table_id`.
