# Directiva: contracte congelat d'OpenAPI

## Objectiu

Garantir que l'esquema OpenAPI generat, l'artefacte versionat i el seu SHA-256
revisat sempre descriuen exactament els mateixos bytes.

## Procediment

1. Generar l'esquema només dins del runtime temporal i sense credencials.
2. Escriure canònicament `openapi/openapi.json` i el seu SHA-256 quan la sortida
   és l'artefacte canònic.
3. En mode `--check`, comparar tant els bytes generats amb l'artefacte com el
   digest real amb `backend/tests/contracts/openapi.sha256`.
4. Fer fallar CI si falta qualsevol artefacte o si algun dels tres valors
   divergeix.
5. Revisar el diff de l'esquema abans d'acceptar un nou hash.

## Restriccions i casos límit

- No consultar dades, fitxers d'entorn ni gestor de credencials.
- No actualitzar el hash canònic quan es genera deliberadament una sortida
  temporal, tret que també s'indiqui una ruta de hash temporal explícita.
- Nota: no considerar vigent l'OpenAPI només perquè els bytes generats
  coincideixen amb `openapi.json`; un hash congelat obsolet deixa inoperant la
  prova de compatibilitat i també ha de fer fallar el guard principal.
- Nota: no copiar el digest des d'un resum, prefix o informe intermedi. Cal
  calcular el SHA-256 complet directament sobre `openapi/openapi.json` i fer-lo
  validar de nou pel generador aïllat.

## Verificació

- Proves del generador amb dues sortides byte-idèntiques.
- Prova negativa amb hash deliberadament obsolet.
- `pnpm check:openapi` i les proves de contracte OpenAPI.
