# Directiva de Manteniment de GitHub Actions

Aquesta directiva defineix el protocol per a la correcció i validació de workflows de GitHub Actions al monorepo.

## 1. Objectiu
Garantir que tots els fitxers de workflow (.yml) siguin vàlids segons l'esquema de GitHub Actions i evitar errors de sintaxi comuns.

## 2. Errors Comuns i Solucions
- **Claus duplicades**: YAML no permet que la mateixa clau (com `path`) aparegui dues vegades al mateix nivell d'un mapa.
    - *Solució*: Utilitzar cadenes multilínia (`|`) si l'acció ho suporta (com `actions/upload-artifact`) o combinar els valors en un sol camp si és possible.
- **Indentació**: GitHub Actions és molt sensible a la indentació. Sempre cal utilitzar 2 espais.
- **Secrets**: Mai posar secrets en text clar. Utilitzar `${{ secrets.NOM_DEL_SECRET }}`.

## 3. Protocol de Correcció
1. Identificar la línia i l'error reportat per GitHub (o el linter).
2. Verificar l'esquema de l'Acció específica (per exemple, `actions/upload-artifact@v4`).
3. Aplicar la correcció al fitxer `.yml`.
4. Validar la sintaxi localment si és possible (p. ex. amb `actionlint`).

## 4. Validació Post-Correcció
- [ ] Validar que no hi hagi claus duplicades.
- [ ] Revisar que la indentació sigui consistent.
- [ ] Confirmar que el fitxer es guarda amb codificació UTF-8.

## 5. Notes Específiques
- En `actions/upload-artifact@v4`, el paràmetre `path` accepta múltiples entrades separades per salts de línia si s'utilitza la sintaxi de bloc YAML `|`.
