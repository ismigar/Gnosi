# Gnosi Web Clipper

Extensió de navegador (Manifest V3) per desar pàgines web —o la selecció de
text— al teu vault de Gnosi. Funciona a Chromium (Chrome, Edge, Brave, Vivaldi,
Opera, Arc), a Firefox i a Safari.

## Com funciona
Envia `POST {backend}/api/public/clip` amb `Authorization: Bearer <PAT>`. El
backend crea una nota a la carpeta `Clips/` del vault amb la font enllaçada, el
contingut capturat i les etiquetes.

## Instal·lació (mode desenvolupador)

Primer, a Gnosi: **Configuració → API i tokens → Crea un token** i copia'l (es
mostra una sola vegada). Després, carrega l'extensió al teu navegador:

### Chromium: Chrome, Edge, Brave, Vivaldi, Opera, Arc
`chrome://extensions` (o `edge://`, `brave://`, `vivaldi://`, `opera://`,
`arc://`) → activa **Mode de desenvolupador** → **Carrega sense empaquetar** →
tria aquesta carpeta (`web-clipper/`).

### Firefox
`about:debugging#/runtime/this-firefox` → **Carrega un complement temporal** →
tria el `manifest.json` d'aquesta carpeta. La instal·lació és temporal: dura
fins que tanques el Firefox. Per fer-la permanent cal signar el paquet a
[addons.mozilla.org](https://addons.mozilla.org/developers/) (puja el
`gnosi-web-clipper-store.zip` que genera `./build.sh`).

A Firefox els permisos de host són **opcionals**: quan deses la configuració,
el navegador et demanarà accés al domini del teu Gnosi. Si el deneges, el
clipper no podrà enviar-hi res.

### Safari (macOS, cal Xcode)
Safari no carrega extensions web directament; cal convertir-les a una app:

```bash
xcrun safari-web-extension-converter monorepo/apps/gnosi/web-clipper
```

Obre el projecte Xcode que genera, compila'l i executa'l un cop. Després,
**Safari → Configuració → Extensions** → activa el clipper (amb *Permet
extensions no signades* al menú Desenvolupament si no la signes amb un compte
de desenvolupador d'Apple).

### Un cop instal·lada (igual a tots els navegadors)
1. Obre el popup de l'extensió → **Configuració** → posa l'URL de Gnosi
   (p. ex. `https://localhost:5173`) i enganxa el token. Desa.
2. En qualsevol web, clica la icona → **Desa aquesta pàgina** (o **només la
   selecció**).

## Notes
- L'endpoint és part de l'API pública amb PAT (`/api/public/*`), separada de la
  sessió de cookies; els tokens es revoquen des de la mateixa pestanya de
  Configuració.
- El codi crida `browser.*` quan existeix (Firefox, Safari) i `chrome.*` altrament
  (Chromium); totes dues variants retornen promeses sota MV3.
- Les notes desades apareixen a `Clips/`; pots reorganitzar-les com qualsevol
  altra nota del vault.
