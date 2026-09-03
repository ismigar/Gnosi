# Directiva: càrrega inicial de Knowledge

## Objectiu

Reduir dràsticament els recursos i bytes descarregats en obrir `/@principal/knowledge`, sense alterar la UX, les rutes ni els contractes de dades.

## Abast

- Perfilar el graf d'importacions i la càrrega real de la ruta Knowledge.
- Convertir les pàgines de feature en fronteres de càrrega diferida reals.
- Carregar inicialment només el catàleg de l'idioma actiu.
- Afegir proves de regressió per a rutes i idiomes.
- Validar amb typecheck, lint, proves enfocades, build i una mesura de navegador local.

## Procediment

1. Capturar una línia base reproduïble: nombre de recursos, bytes transferits, fitxers de traducció i mòduls grans.
2. Identificar imports estàtics que travessen fronteres de ruta o índexs que reexporten features sencers.
3. Fer que cada ruta importi directament i de manera diferida el seu component de pàgina.
4. Separar el registre lleuger de locales dels catàlegs pesants i resoldre el locale actiu abans d'inicialitzar i18next.
5. Preservar el canvi d'idioma en calent carregant el catàleg sol·licitat abans d'activar-lo.
6. Repetir exactament la mesura inicial i comparar recursos, bytes i catàlegs carregats.

## Restriccions i casos límit

- No tocar backend, OpenAPI, dades personals ni serveis externs.
- No canviar URLs, textos visibles, fallbacks, detecció d'idioma ni navegació.
- No importar índexs agregadors des del router: poden executar tots els features encara que exportin components `lazy`.
- No usar glob eager per als JSON de traducció. Cal mantenir loaders dinàmics explícits i validats.
- El locale desat pot tenir regió o majúscules diferents; cal normalitzar-lo amb el mateix registre canònic abans de carregar-lo.
- Si el catàleg sol·licitat falla, cal conservar un fallback local conegut i no deixar la UI sense recursos.
- Les proves han de demostrar que l'arrencada no sol·licita catàlegs no actius i que canviar d'idioma en carrega només el necessari.
- Nota: no executar una instal·lació offline completa assumint que el magatzem pnpm conté tots els tarballs, perquè pot fallar amb `ERR_PNPM_NO_OFFLINE_TARBALL`. En un worktree aïllat sense xarxa, cal reutilitzar una còpia local de les dependències canòniques ja verificades i mantenir-la fora del commit.
- Nota: no activar `onlyExplicitManualChunks` en aquesta base, perquè Vite 8/Rolldown el rebutja com una opció de sortida invàlida. Cal retirar els agrupaments manuals que converteixen un vendor diferit en dependència estàtica de l'entrada.
- Nota: Chromium headless pot fallar dins del sandbox de macOS amb `MachPortRendezvousServer: Permission denied`. Cal executar només el procés de navegador amb permís local ampliat i bloquejar explícitament qualsevol host que no sigui loopback.

## Criteris d'acceptació

- Knowledge conserva el mateix resultat visual i funcional.
- La càrrega inicial descarrega un únic `translation.json`.
- Les pàgines no actives no formen part del graf inicial de Knowledge.
- Typecheck, lint, proves enfocades i build passen.
- Les mesures abans/després queden documentades i són reproduïbles.

## Resultat verificat

- El graf JS estàtic de producció baixa de 3.300.047 a 571.891 bytes, un 82,7% menys.
- La navegació equivalent a Knowledge amb Chromium i APIs fictícies baixa de 2.047.554 a 1.776.243 bytes transferits, un 13,3% menys, i de 6.886.447 a 6.034.661 bytes descomprimits.
- La prova de navegador carrega un únic catàleg actiu (`ca`); abans els quatre catàlegs estaven incrustats a l'entrada.
- Editor, calendari, PDF i dibuix deixen de ser dependències estàtiques d'arrencada.
- El nombre d'assets de la ruta completa es manté en 157 perquè Knowledge continua necessitant els seus components i icones; la millora és en bytes i en evitar codi d'altres rutes.
