# Directive: Media Manager KPM (Gnosi)

## Objectiu
Establir els principis de disseny i operació per al gestor fotogràfic integrat a Gnósi, basat en la metodologia KPM (Knowledge, Projects, Management).

## Principis de Categorització

### 1. Knowledge (K) - Coneixement
- **Definició**: Actius visuals que contenen informació reutilitzable a llarg termini.
- **Exemples**: Esquemes tècnics, diagrames de flux, fragments de llibres, captures de pantalles de configuracions.
- **Accions**:
  - OCR obligatori per a cerques de text.
  - Enllaç obligatori a una Wiki Page o un concepte del Graf.

### 2. Projects (P) - Projectes
- **Definició**: Fotos que documenten l'estat o l'execució d'un projecte actiu amb data d'inici i fi.
- **Exemples**: Fotos de campanya, evolució d'obres/manteniment, mocks de disseny, inspiració/moodboards.
- **Accions**:
  - Ordenació cronològica estricta per defecte.
  - Filtrat per `Project_ID`.

### 3. Management (M) - Gestió
- **Definició**: Actius logístics, administratius o de manteniment de l'entorn de vida/treball.
- **Exemples**: Rebuts, factures, fotos d'inventari, comprovants de pagament, captures de tiquets de suport.
- **Accions**:
  - Auto-detecció de tipus "Factura/Rebut".
  - Extracció de dades numèriques (imports, dates).
  - Integració amb el flux de tasques/calendari.

## Protocol d'Ingesta (SOP)
1. Per a cada nova imatge, generar un Hash únic per evitar duplicats.
2. Emmagatzemar l'original a `_assets/YYYY/MM/`.
3. Executar pipeline d'enriquiment en background (Thumbnail -> OCR -> AI Tags).
4. Sol·licitar a l'usuari la designació de la lletra K, P o M si no es pot inferir automàticament.

## Restriccions i Casos Vora
- **Duplicats**: Si una imatge és projecte i coneixement alhora, s'ha de permetre la doble vinculació sense duplicar fitxer.
- **Privadesa**: Les imatges amb dades sensibles (Management) han de tenir una marca visual de "Privat".
