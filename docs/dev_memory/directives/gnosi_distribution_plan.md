# Gnosi Distribution Plan

> Product decision: support a single-user desktop application and team
> self-hosting. Gnosi is not planned as a SaaS product.

## Architectural invariant

Keep a clean HTTP API boundary between the React frontend and FastAPI backend.
The same codebase can then run as:

- A local desktop application with a bundled backend sidecar.
- A self-hosted server used through browsers.

Do not couple frontend behavior to assumptions that the backend is local or
that every deployment has one user.

## Current PWA

The installable PWA provides a standalone daily-use window against the native
development services. The manifest, icons, theme metadata, and Apple metadata
must remain valid. It is a convenience for current use, not the distributable
desktop release.

## Desktop mode

Prefer Tauri for a lightweight system WebView. Development points to the live
frontend server; release CI builds installers from tags.

The difficult part is packaging Python and ML dependencies. Prefer a lightweight
ONNX embedding path for desktop builds, with heavyweight local translation or
ML components optional and downloaded only when selected.

macOS signing and notarization require appropriate release credentials.

## Team self-hosting

Docker Compose and Dockerfiles remain the supported Linux/server recipe.
Publish versioned images and document vault path, local data, secrets, backup,
and TLS configuration.

The macOS OneDrive issues that motivated native development do not make Docker
an invalid server deployment mode.

## Authentication dependency

Team mode requires per-user secrets and centrally enforced vault access before
it is safe. Follow `auth_multiuser_design.md`.

Personal desktop mode remains login-free for one owner.

## Phases

1. PWA for current daily use.
2. Tauri desktop package with release CI.
3. Complete organization authentication and authorization.
4. Publish and document team self-host images.
5. Add signing, notarization, and release channels.

## Restrictions

- Preserve the HTTP boundary.
- Do not bundle unnecessary heavyweight ML dependencies.
- Build installers for releases, not every source change.
- Keep Docker recipes healthy even though local development is native.
- Treat authentication and tenant isolation as security-critical.
- Default interface and distributed documentation are English; users may
  select another supported interface language.
