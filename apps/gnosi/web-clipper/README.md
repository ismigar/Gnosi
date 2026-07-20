# Gnosi Web Clipper

Extensió de navegador (Chrome/Edge/Brave, Manifest V3) per desar pàgines web —o
la selecció de text— al teu vault de Gnosi.

## Com funciona
Envia `POST {backend}/api/public/clip` amb `Authorization: Bearer <PAT>`. El
backend crea una nota a la carpeta `Clips/` del vault amb la font enllaçada, el
contingut capturat i les etiquetes.

## Instal·lació (mode desenvolupador)
1. A Gnosi: **Configuració → API i tokens → Crea un token** i copia'l (es mostra
   una sola vegada).
2. A Chrome: `chrome://extensions` → activa **Mode de desenvolupador** → **Carrega
   sense empaquetar** → tria aquesta carpeta (`web-clipper/`).
3. Obre el popup de l'extensió → **Configuració** → posa l'URL de Gnosi
   (p. ex. `https://localhost:5173`) i enganxa el token. Desa.
4. En qualsevol web, clica la icona → **Desa aquesta pàgina** (o **només la
   selecció**).

## Notes
- L'endpoint és part de l'API pública amb PAT (`/api/public/*`), separada de la
  sessió de cookies; els tokens es revoquen des de la mateixa pestanya de
  Configuració.
- Les notes desades apareixen a `Clips/`; pots reorganitzar-les com qualsevol
  altra nota del vault.
