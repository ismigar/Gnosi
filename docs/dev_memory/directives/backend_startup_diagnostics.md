# Diagnòstic d'arrencada del backend

## Objectiu

Fer que qualsevol bloqueig durant la importació de l'aplicació o l'arrencada nativa produeixi evidència accionable sense accedir a dades personals.

## Procediment

1. Executar sempre els diagnòstics amb un vault i un directori de dades temporals.
2. Activar un bolcat de totes les piles si la importació supera seixanta segons.
3. Repetir el bolcat mentre el procés continuï viu, perquè una espera externa no sembli una fallada silenciosa.
4. Cancel·lar el temporitzador tan bon punt finalitzi la importació.
5. Conservar al log de CI els últims missatges del backend i del frontend quan l'arrencada no respon.
6. Corregir la inicialització bloquejant al seu propietari; no ampliar el timeout sense diagnòstic.

## Restriccions i casos límit

- No utilitzar el vault real, credencials ni proveïdors externs per reproduir el problema.
- No imprimir variables d'entorn ni contingut de configuració.
- Nota: no s'ha d'insistir amb `uv run` si el runtime macOS falla a `system-configuration` intentant crear un objecte nul dins el sandbox. En lloc d'això, cal usar el Python de `.venv` ja sincronitzat per als diagnòstics locals; la CI continuarà validant el flux reproduïble amb `uv` a Linux.
- Nota: no s'ha d'interpretar un procés viu sense port obert com una arrencada lenta, perquè pot estar bloquejat durant un import. En lloc d'això, cal obtenir bolcats de pila periòdics.
- Nota: no s'ha d'invocar Secret Service en un Linux sense `DISPLAY` ni
  `WAYLAND_DISPLAY`. Pot obrir un prompt DBus invisible i bloquejar l'arrencada
  indefinidament. En lloc d'això, cal ometre el keyring interactiu i usar el
  fallback xifrat dins `GNOSI_DATA_DIR`.
- Nota: no s'ha de tallar el probe natiu perquè mori el PID d'un wrapper
  `pnpm` o `uv`; aquests llançadors poden transferir el procés i deixar Vite o
  Uvicorn vius amb un PID diferent. La decisió d'arrencada ha de dependre dels
  dos endpoints HTTP dins un termini finit, i el log s'ha de mostrar només si
  aquest termini expira.
- El smoke sintètic ha de desactivar el scheduler: no és necessari per provar
  els ports i pot introduir treball de fons aliè a l'arrencada.
- El diagnòstic ha de quedar inactiu després d'una importació correcta i no ha d'afectar el servidor en execució.

## Verificació

- La generació d'OpenAPI continua sent determinista.
- Una importació artificialment bloquejada genera una pila després del límit configurat.
- L'arrencada nativa conserva els ports 5002 i 5173 i mostra les piles si el backend no arriba a escoltar.
