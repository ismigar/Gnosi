# Directiva: Gestió d'Històric i Filtres en el Lector

**Estat:** Staging
**Data:** 2026-04-09
**Relacionat amb:** #Reader #UX #Database

## Requeriments de Negoci
1. **Històric Complet**: El sistema no ha de descartar articles antics en la descàrrega només per la seva data si el feed encara els ofereix.
2. **Filtratge**: L'usuari ha de poder filtrar la llista d'articles per font (mitjà) per gestionar millor el volum d'informació.
3. **Visibilitat**: Ha de ser fàcil alternar entre "veure només pendents" i "veure tot l'històric (incloent-hi llegits)".

## Implementació Tècnica

### Backend (Ingesta)
- Eliminar restriccions temporals d'ingesta a `feed_ingester.py`.
- L'unicidad es manté per la URL de l'article per evitar duplicitats.

### Backend (API)
- Afegir `source_id` com a paràmetre de consulta.
- L'endpoint `/api/reader/articles` ha de respondre amb el resum del mitjà per facilitar el filtratge al frontend.

### Frontend
- Mantindre un estat `selectedSourceId`.
- Incloure un botó de reset per al filtre.
- El toggle per a mostrar llegits ha de persistir durant la sessió.

## Control de Qualitat
- Verificar que en seleccionar un mitjà, el recompte d'articles es correspon amb el de la base de dades per aquell `source_id`.
- Verificar que la càrrega d'històric (centenars d'articles) no degrada la performance de la UI (usar virtualització si cal, tot i que per a 500 articles no hauria de ser un problema).
