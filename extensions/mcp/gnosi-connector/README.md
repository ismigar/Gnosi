# Gnosi connector for ChatGPT and MCP clients

Private, single-owner connector for a running Gnosi installation. Read-only
tokens remain read-only; page writing requires an explicitly granted write scope.
The same Python package runs on macOS, Windows and Linux; Docker runs it as a
separate service. It uses Gnosi's authenticated API, not direct vault files.
Version 0.3 adds page proposals and revision-checked edits, while selecting any accessible vault per call without changing
the installed desktop app, its backend or the vault selected in its UI.

## Available tools

| Tool | Behavior |
| --- | --- |
| `list_vaults(limit, offset)` | Discovers accessible vault slugs and identifies the configured default. Names of denied vaults and filesystem paths are not returned. |
| `search(query, vault?)` | Case-insensitive title/folder search; 50 results, scanning at most 5,000 pages. Reports `partial` when a limit is reached. Not full-text search. |
| `fetch(id, vault?)` | Reads a page/record's Markdown, up to 60,000 characters; reports `truncated`. |
| `list_pages(limit, offset, vault?)` | Lists pages/records with table IDs, up to 100 per call; returns `next_offset`. |
| `list_tables(limit, offset, vault?)` | Lists table names and database IDs, up to 100 per call. |
| `prepare_page_change(vault, title, content, id?)` | Prepares an exact 10-minute proposal; omit ID to create a root page or supply ID to edit. Does not save. Requires read,write scope. |
| `commit_page_change(proposal_id)` | Consumes a proposal once and writes it. Requires explicit user confirmation in the host. No deletion, metadata editing or forced overwrite. |

Use a slug returned by `list_vaults`, such as `principal` or `proves`, in the
`vault` argument. Omitting it uses `GNOSI_VAULT_SLUG` as the default. Without a
configured default, content tools require an explicit vault. Discovery remains
available. Each result identifies its vault; carry that vault into subsequent
fetch calls because page IDs can repeat across vaults. Selection is local to
each request, so concurrent calls cannot change one another's target.

Discovery checks each candidate through Gnosi's canonical authorized page route
before returning its name. Follow `next_offset` even when a result page contains
no accessible vaults: discovery pagination counts catalog entries, not just
accessible entries. It is scoped to the account's selected workspace
(`GNOSI_WORKSPACE_ID` where needed). An access denial is never retried against
the default vault.

No deletion, arbitrary URLs, SQL, filesystem access or
automatic switching of vaults is exposed. A token is validated, including its
`read` scope, on every tool call. The connector uses canonical vault routes;
an unknown slug fails rather than falling back to the desktop's selected vault.
Gnosi remains responsible for account/workspace authorization.

## Editing safety (0.3)

Use `configure_local --enable-writes` only after explicit authorization; it
creates a separate read,write PAT. Keep the old read-only profile for rollback.
Writes require an explicit vault, a title and complete Markdown body up to
60,000 characters. Preparation returns before/after for user review. Editing
uses PATCH with a mandatory server-issued expected_etag; a conflict aborts and
requires a new proposal and confirmation. The existing backend checks the
revision under its page write lock. External filesystem/cloud writers can
still race this lock; it is not a cross-device transaction guarantee.

The commit tool is marked non-read-only, destructive (it can replace content),
and non-idempotent. Configure ChatGPT to ask before every commit. MCP annotations
and model instructions are not an authorization boundary: the connector cannot
prove a human clicked approval. A caller with tool access and a write-scoped PAT
can prepare and commit. Use only a trusted single-owner host; do not enable
automatic approval for writes. Proposals are process-local, expire after ten
minutes and are consumed before dispatch; after an ambiguous failure inspect
Gnosi rather than retrying. Restarting the connector invalidates proposals.

En català: pots crear pàgines i proposar canvis de títol i contingut, sempre
indicant el vault. Revisa la proposta i confirma el desament a ChatGPT. No hi ha
cap eina d’eliminació. El token antic continua sent de només lectura.

## Install on macOS, Windows or Linux

Requires Python 3.11 or later and a running Gnosi backend supporting
`/api/v1/vaults/{slug}/knowledge/...` and personal access tokens.
From this directory, use a separate virtual environment:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install .
```

Windows PowerShell:

```powershell
py -3 -m venv .venv
.venv\Scripts\python.exe -m pip install .
```

In **Gnosi → Settings → API and tokens**, create a personal access token with
the `read` scope. Save it in a local private file outside this repository;
do not paste it into a chat, a committed config or the plugin manifests.
On Unix restrict its file permissions to your user; on Windows restrict its ACL.

Set these environment variables in the process that launches the connector:

| Variable | Meaning |
| --- | --- |
| `GNOSI_BASE_URL` | Backend origin, default `http://127.0.0.1:5002`. Desktop can select another port if 5002 is occupied; use the actual backend port. |
| `GNOSI_VAULT_SLUG` | Optional default vault slug, as in Gnosi's `/@slug/knowledge/...` navigation. Each tool can explicitly select another accessible vault. |
| `GNOSI_TOKEN_FILE` | Path to the file containing the Gnosi PAT. Alternatively set `GNOSI_TOKEN`, never both. |
| `GNOSI_WEB_URL` | Optional browser-accessible Gnosi frontend origin, used for source links. |
| `GNOSI_WORKSPACE_ID` | Optional workspace ID for organization installations. |
| `GNOSI_ALLOW_PRIVATE_HTTP` | Set to `1` only for an explicitly trusted container/private network using HTTP. Non-loopback upstreams otherwise require HTTPS. |

macOS/Linux example (replace the slug and file path):

```sh
export GNOSI_BASE_URL=http://127.0.0.1:5002
export GNOSI_VAULT_SLUG=your-vault-slug
export GNOSI_TOKEN_FILE=/absolute/private/path/gnosi-token
.venv/bin/gnosi-connector --check
.venv/bin/gnosi-connector
```

PowerShell equivalent:

```powershell
$env:GNOSI_BASE_URL = 'http://127.0.0.1:5002'
$env:GNOSI_VAULT_SLUG = 'your-vault-slug'
$env:GNOSI_TOKEN_FILE = 'C:\private\gnosi-token'
.venv\Scripts\gnosi-connector.exe --check
.venv\Scripts\gnosi-connector.exe
```

The normal command speaks MCP over stdio, so it waits for a client. Protocol
output goes to stdout, diagnostics to stderr. `--check` prints only whether
authentication and vault access succeeded; it does not print note content.
With no web frontend configured, source URLs point to the local authenticated
JSON API. Those links are not usable from another device and may require a
browser session. Set `GNOSI_WEB_URL` for browser-friendly citations.

### Optional local setup helper

On an unauthenticated **personal, loopback-only** desktop installation, the
helper can resolve a vault by name, create a dedicated `read` PAT and save it
outside the repository. It refuses an existing destination and attempts to
revoke the new PAT if verification or saving fails. On authenticated/remote
installations, use Gnosi's token settings instead.

```sh
.venv/bin/python -m gnosi_connector.configure_local --vault PRINCIPAL --directory /absolute/private/new-directory
.venv/bin/gnosi-connector --config /absolute/private/new-directory/profile.json --check
```

Use the equivalent `.venv\Scripts\python.exe` and executable on Windows.
The profile contains the default vault, origin and token-file path, not the
token itself. Add `--config /absolute/path/profile.json` to the tunnel's MCP
command to select it without relying on GUI environment inheritance. On Unix,
the helper creates a 0700 directory and 0600 files; verify private user ACLs
on Windows. Revoke the named **Gnosi ChatGPT (vault-slug)** token in Gnosi to
disconnect the bridge. The token's historical name does not restrict it to
that vault: the PAT is an account credential, not a vault-scoped credential.
All callers of this connector can select any vault accessible to that account.

## Connect to ChatGPT using Secure MCP Tunnel

Use the official [Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).
Create/associate a tunnel with the intended ChatGPT workspace and obtain the
required tunnel permissions. Developer-mode access is separate from tunnel
permissions. Install the official `tunnel-client` for the machine's platform.

Configure its stdio profile to launch the absolute path to the installed
`gnosi-connector` executable (`.exe` on Windows), with the environment above.
The tunnel process must inherit those variables and be able to read the PAT
file. Use `tunnel-client help quickstart` and the official guide for your version.
Keep the tunnel's control-plane API key separate from the Gnosi PAT.

In ChatGPT Plugins, add a developer-mode connection, choose **Tunnel**, select
the associated tunnel, and verify the five advertised tools. Test a known
title, then read one result. The Mac/PC, Gnosi backend and tunnel must remain
running; sleep or a disconnected network makes the tools unavailable.

The manifests in this directory are local plugin packages. Uploading a package
does not deploy the process or connect a local machine to ChatGPT. Actual
ChatGPT connection is incomplete until the user's tunnel/account setup and a
real tool call succeed. No tunnel or account connection is created by this code.

## Authenticated HTTP and Docker

HTTP mode serves Streamable HTTP at `/mcp`. It requires a separate, random
`GNOSI_MCP_TOKEN` of at least 32 characters, or `GNOSI_MCP_TOKEN_FILE`.
Generate/store the secret locally; do not reuse the Gnosi PAT. Clients must
send `Authorization: Bearer <connector-key>` on every request. This is a
single-owner service: every authorized caller can select any vault accessible
to the configured Gnosi account in its selected workspace.

```sh
.venv/bin/gnosi-connector --transport http --host 127.0.0.1 --port 8787
```

Docker Compose reads `GNOSI_BASE_URL`, `GNOSI_VAULT_SLUG`, `GNOSI_TOKEN_FILE`
and `GNOSI_MCP_TOKEN_FILE` from the shell or an untracked `.env`. The last two
are host paths to separate secret files. Then:

```sh
docker compose up --build -d
```

The included Compose file publishes only `127.0.0.1:8787`, runs as UID 10001
with a read-only filesystem and mounts secrets at `/run/secrets/`. Ensure the
mounted files are readable by that container user. It does not mount a vault.

If Gnosi runs in another container, attach this service to the same Docker
network and set its API origin to that service name and port. For private HTTP,
explicitly set `GNOSI_ALLOW_PRIVATE_HTTP=1`. For a host service, Docker Desktop
provides `host.docker.internal`; Linux may need an `extra_hosts` mapping to
`host-gateway`. A host backend listening only on loopback is not necessarily
reachable from a container: use a shared container network or run the connector
natively alongside a desktop Gnosi instance.

For an HTTP tunnel profile, configure the MCP URL and Authorization header
using the installed tunnel client's supported options. For an HTTPS reverse
proxy, preserve Authorization, protect the upstream network and set
`GNOSI_MCP_ALLOWED_HOSTS` to the actual external hostname (comma-separated,
include `hostname:*` when non-default ports are used). No browser Origins are
allowed by default. Do not disable host validation globally.

Direct public ChatGPT connection with user sign-in requires an OAuth-capable
deployment/gateway; this version does **not** implement OAuth discovery,
multi-user token exchange or a public-directory submission. The supported
personal ChatGPT setup is the private tunnel with stdio. Docker/HTTP supports
MCP clients that supply the configured bearer key.

## Local plugin hosts

`plugin.json`/`mcp.json` are the portable package; `.codex-plugin/plugin.json`
and `.mcp.json` provide the Codex compatibility overlay. Both launch the same
entrypoint with `uv`, using the plugin source as an isolated dependency rather
than installing Gnosi's full application runtime. Install `uv` and make it
available to the GUI host's PATH; provide the Gnosi environment to that host.
No credentials are embedded. An offline installation can use the already
installed executable instead of the `uv` launcher in a host-specific config.

## Verification

```sh
.venv/bin/python -m pip install pytest
.venv/bin/python -m pytest -q
```

The tests exercise real MCP initialization, tool discovery and calls against
a synthetic Gnosi HTTP API, plus a separate stdio process and authenticated
Streamable HTTP. They cover revoked/missing scopes, redirects, path injection,
bounded responses, pagination and host validation. They do not replace a live
Gnosi/ChatGPT test. Cross-platform execution and the Docker build are included
in the repository's dedicated CI workflow.

## Resum en català

Connector de lectura per a macOS, Windows, Linux i Docker. Llista els vaults
accessibles i permet seleccionar-ne un a cada consulta: cerca títols i carpetes,
llegeix pàgines i llista pàgines i taules. Configura l'adreça del backend,
opcionalment un vault predeterminat, i un token
personal amb permís `read`, desat en un fitxer privat. Executa `--check` per
comprovar l'accés. Per utilitzar-lo a ChatGPT, encara cal configurar el túnel
segur al teu compte i verificar-hi una consulta real. No inclou escriptura ni
autenticació OAuth multiusuari en aquesta primera versió.
