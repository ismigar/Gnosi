# Publicar el Web Clipper a la Chrome Web Store

Dossier de preparació. **Els passos de compte, pagament i acceptació de termes
els ha de fer una persona** — no són automatitzables ni delegables.

## Per què val la pena

Ara mateix el clipper s'instal·la en **mode desenvolupador** («Carrega sense
empaquetar»). Això vol dir: cada usuari ha d'activar el mode dev del navegador,
Chrome li ensenya un avís permanent, i no hi ha actualitzacions automàtiques.
És la limitació que fa que aquest connector no pugui presentar-se com a estable.

## Bloquejos que només pots resoldre tu

1. **Compte de desenvolupador** a
   [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. **Quota única de 5 USD** de registre.
3. **Acceptar els termes** del programa per a desenvolupadors.

Fins que aquests tres no estiguin fets, la resta del dossier no es pot fer servir.

## El paquet

```bash
./build.sh
```

Genera dos ZIP, i la diferència és important:

| Fitxer | Forma | Per a què |
|---|---|---|
| `gnosi-web-clipper.zip` | tot dins de `web-clipper/` | «Carrega sense empaquetar» i la release de GitHub |
| `gnosi-web-clipper-store.zip` | `manifest.json` a l'arrel | **la botiga** — rebutja un ZIP amb el manifest dins d'una carpeta |

## El punt que et faran repetir: els permisos

El `manifest.json` declara:

```json
"permissions": ["activeTab", "scripting", "storage"],
"host_permissions": ["http://localhost/*", "https://localhost/*",
                     "http://127.0.0.1/*", "<all_urls>"]
```

**`<all_urls>` és el que fa saltar la revisió.** Demana accés a qualsevol lloc
web, i la botiga exigeix justificar-lo un per un al formulari de privacitat.
Justificacions per a cada entrada:

- **`activeTab`** — llegir el títol i la URL de la pestanya que l'usuari té al
  davant, només quan clica el botó de l'extensió.
- **`scripting`** — executar una funció que retorna el text seleccionat. No
  injecta res persistent ni modifica la pàgina.
- **`storage`** — desar en local la URL del backend de l'usuari i el seu token
  d'API. No surt del dispositiu.
- **`host_permissions` de localhost/127.0.0.1** — el cas habitual: el Gnosi de
  l'usuari corre a la seva pròpia màquina.
- **`<all_urls>`** — necessari perquè l'usuari pot allotjar el seu Gnosi a
  **qualsevol** domini propi (és programari autoallotjable) i el clipper hi ha
  d'enviar la petició. **Aquest és el punt feble de la sol·licitud.**

### Alternativa que t'estalviaria la discussió

Substituir `<all_urls>` per **`optional_host_permissions`**: l'extensió no
demanaria res per endavant i, quan l'usuari configurés el seu backend, Chrome
li demanaria permís només **per a aquell domini concret**. És més feina
(cal cridar `chrome.permissions.request()` en desar la configuració) però
converteix la sol·licitud més arriscada en una de rutinària, i és millor
privacitat de debò, no només de cara a la revisió.

Recomanació: fer aquest canvi **abans** d'enviar-ho, no després d'un rebuig.

## Declaració de privacitat (la demanaran)

- L'extensió **no recull** analítica, ni telemetria, ni identificadors.
- Les úniques dades que surten del navegador van **al servidor que l'usuari ha
  configurat ell mateix** (per defecte, la seva pròpia màquina).
- El token d'API viu a `chrome.storage.local` i no es transmet enlloc més que
  a aquell servidor, com a capçalera `Authorization`.
- No hi ha servidors nostres pel mig. Cal marcar-ho així al formulari.

## Abans d'enviar-ho

- [ ] Puja `version` al `manifest.json` — la botiga rebutja una versió ja vista.
      **Nota**: ara diu `1.0.0` mentre viatja en el tren de releases `0.1.x`;
      val la pena alinear-ho abans de publicar res amb aquest número.
- [ ] Decideix el tema de `<all_urls>` (vegeu l'alternativa de dalt).
- [ ] Icones: la botiga en vol de 128×128. El `manifest.json` **no en declara
      cap** ara mateix.
- [ ] Captures de pantalla del popup (1280×800 o 640×400).
- [ ] Descripció curta (132 caràcters) i llarga.
- [ ] Política de privacitat accessible per URL pública.
- [ ] `npm test` verd al frontend (cobreix la lògica del popup).

## LibreOffice: l'altre canal

El `.oxt` es pot publicar a
[extensions.libreoffice.org](https://extensions.libreoffice.org/). També cal
compte, però **no hi ha quota ni revisió comparable** — és molt més barat que
la Chrome Web Store. Si vols obrir un canal de distribució de debò, comença per
aquest.
