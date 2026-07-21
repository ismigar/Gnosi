# Publicar Gnosi Cite a extensions.libreoffice.org

Dossier de preparació per treure el `.oxt` del «baixa'l de GitHub i instal·la'l
a mà». **Els passos de compte i acceptació de termes els ha de fer una
persona.** La resta és a punt.

Contingut verificat el 2026-07-21 contra la [guia oficial per a
mantenidors](https://extensions.libreoffice.org/en/home/using-this-site-as-an-extension-maintainer).

## El compte

Un **compte de The Document Foundation** — el mateix single sign-on de tota la
infraestructura de LibreOffice, no un registre específic d'aquest lloc.

1. Crea'l a **<https://user.documentfoundation.org>**
2. Entra després a **<https://extensions.libreoffice.org/admin>**

**Gratuït.** La documentació de manteniment no esmenta cap quota.

## Sí que hi ha moderació

> «after you hit publish, the request will be handled by a moderator»

Una persona ho revisa abans de fer-ho visible. Els **criteris i els terminis no
estan documentats públicament**, així que no comptis amb una publicació
immediata. La diferència amb la Chrome Web Store no és que ningú s'ho miri:
és que no hi ha quota ni cal justificar permisos un per un.

## El procés

1. Crear l'entrada: títol, descripció, **logo**, etiquetes.
2. **Desar-la primer en anglès** — l'anglès és obligatori; les altres llengües
   són traduccions opcionals a sobre.
3. Afegir una *release* amb «Add Extension Release» i adjuntar el `.oxt`.
4. Opcionalment traduir la fitxa (ca/es encaixarien amb el projecte).
5. Publicar → cua de moderació.

Dubtes de procés: [fòrum d'extensions de la
comunitat](https://community.documentfoundation.org/c/extensions/36).

## Què falta al nostre costat

Tres coses, cap difícil, però totes bloquegen la fitxa:

- [ ] **Logo.** La fitxa en demana un i el `.oxt` **no en declara cap**. Cal
      decidir art i afegir-lo (i, ja posats, al `description.xml` de
      l'extensió, que tampoc en té).
- [ ] **Descripció en anglès.** El [README](README.md) de l'extensió és en
      català; l'entrada del lloc exigeix l'anglès com a idioma base. Cal
      escriure'n una de nova, no traduir el README sencer: la fitxa vol un
      text curt orientat a l'usuari, no documentació d'instal·lació.
- [ ] **Decidir què es promet.** La versió actual reformata cites al cos i a
      les taules, **però no a capçaleres ni peus** (vegeu «Compatibilitat
      coneguda» al README). Val la pena que la fitxa ho digui, en comptes que
      ho descobreixi un usuari amb una tesi a mig escriure.

## Què ja està a punt

- El `.oxt` es construeix amb `./build.sh` i la seva versió surt del
  `description.xml`.
- La lògica de recorregut del document té proves (`tests/`), executades a CI
  per `backend-tests.yml`.
- El README documenta la instal·lació, els paranys del Gestor d'extensions i
  la compatibilitat coneguda.
- Hi ha històric de releases a GitHub (`plugins-v0.1.x`) del qual es pot
  treure el fitxer i el text de canvis.

## Nota sobre versions

La versió de la fitxa i la del `description.xml` han de coincidir, i
LibreOffice indexa la caché d'extensions per versió: **puja-la sempre que
canviï el payload**, o l'usuari es quedarà amb el codi antic sense adonar-se'n
(vegeu la directiva `libreoffice_cite_extension.md`).

## L'altre canal

El Web Clipper té el seu propi dossier, més car i amb més fricció:
[`web-clipper/STORE_SUBMISSION.md`](../../web-clipper/STORE_SUBMISSION.md).
