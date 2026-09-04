# Descàrregues de dependències resilients en Docker

## Objectiu

Fer que la construcció reproduïble de la imatge frontend suporti connexions lentes
o intermitents al registre npm sense relaxar el lockfile ni amagar errors reals.

## Pla

1. Mantenir Node, pnpm i el `pnpm-lock.yaml` fixats.
2. Configurar al workspace un nombre finit de reintents, temps d'espera prou
   amplis i concurrència moderada, i copiar aquesta configuració a la imatge.
3. Mantenir `pnpm install --frozen-lockfile` com a única frontera d'instal·lació.
4. Fixar el contracte amb proves estàtiques i validar la construcció real de la
   imatge quan el runner estigui disponible.
5. Aplicar els límits de xarxa també com a variables dels workflows, perquè la
   instal·lació inicial de pnpm ocorre abans que pnpm pugui llegir el workspace.
6. Permetre fins a cinc minuts perquè el backend Docker arribi a `healthy` sota
   pressió de CPU/I/O, mantenint un límit finit i configurable.

## Restriccions i casos límit

- Note: Do not add or stage a new directive and then run the documentation gate
  without regenerating the repository inventory. The directive list is part of
  the generated public reference; run the documentation generator and then the
  localization synchronizer so the ca/es/fr inventories remain identical.
- Note: Do not treat registry timeouts after the lockfile verification succeeds
  as source-code or lockfile failures. Instead, preserve frozen installation and
  use bounded retries, longer timeouts, and lower network concurrency.
- Note: Do not protect only the Docker build. Frontend, native smoke and release
  jobs use the same registry and can fail under the same degraded connection.
  Keep the policy in the root `pnpm-workspace.yaml`, which pnpm 11 treats as the
  canonical project configuration and which the frontend image already copies.
- Note: Do not put these settings in `.npmrc` for this pnpm 11 workspace. They
  are ignored by `pnpm config list --location project`; use the canonical
  camelCase keys in `pnpm-workspace.yaml` and verify their resolved values.
- No s'ha d'introduir una espera o un bucle infinit: una caiguda sostinguda del
  registre ha de continuar fallant amb un error visible.
- Note: Do not assume `pnpm-workspace.yaml` protects `pnpm/action-setup`; that
  installer runs before the project pnpm exists. Export the same bounded npm
  retry and timeout settings at workflow scope.
- Note: Do not insert a workflow-level `env` by matching an arbitrary nested
  `env` block. It can corrupt step indentation in release YAML. Place it after
  root permissions and parse every workflow before committing.
- Note: Do not use the one-minute Docker readiness window as evidence that a
  valid backend image is broken under a saturated ARM64 runner. Keep a bounded
  five-minute readiness budget and print container state and logs on expiry.
- No s'ha de desactivar SSL, la verificació d'integritat ni les polítiques de
  cadena de subministrament.
- No s'ha d'augmentar la concurrència per compensar una connexió lenta; això
  empitjora la contenció del runner i el registre.

## Validació

- Prova del contracte del Dockerfile per a lock congelat, reintents, timeouts i
  concurrència limitada.
- Suite enfocada de contractes de contenidor.
- Construcció i smoke test Docker al runner Linux ARM64.
