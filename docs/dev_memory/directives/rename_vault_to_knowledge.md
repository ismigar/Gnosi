# Rename Vault to Knowledge

## Context
Hem rebatejat la component que engloba la Base de Dades (BD) i la Wiki. Abans s'anomenava **Vault**, però ara aquest terme s'utilitzarà per referir-se a tot el sistema (el contenidor global). La component específica de dades i documents ara s'anomena **Knowledge** (Coneixement).

## Propositiu
Mantenir la coherència visual i terminològica a tota l'aplicació, assegurant que l'usuari vegi "Knowledge" (o la seva traducció) en lloc de "Vault" quan es refereixi a la secció de BD i Wiki.

## Procediment de Traducció
- **Anglès (en)**: Knowledge
- **Català (ca)**: Coneixement
- **Castellà (es)**: Conocimiento
- **Francès (fr)**: Connaissance

## Restriccions i Regles
- No canviar claus de traducció si no és estrictament necessari per evitar trencar la UI, a menys que es faci un refactoring complet de les referències al codi.
- Prioritzar el canvi dels valors (labels) que l'usuari veu.
- Si apareix "My Vault", canviar a "My Knowledge" (o traducció equivalent).

## Errors Comuns a Evitar
- No canviar "Vault" quan es refereix a la ruta del sistema (`vault_path`), ja que això podria afectar la persistència local si no es canvia també al backend. *Nota: En aquesta fase ens centrem en la terminologia de la component UI.*
