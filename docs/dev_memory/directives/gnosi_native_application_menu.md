# Gnosi Native Application Menu

## Intent

Provide a deliberate desktop application menu instead of Electron's default
development-oriented template. The menu must follow the interface language
selected inside Gnosi, expose the expected macOS window lifecycle actions, and
open existing Gnosi surfaces rather than duplicating them.

## Source of truth

- Electron owns menu roles, accelerators, window creation, update checks, and
  delivery of menu commands to renderer windows.
- The React i18n catalogs own every visible menu label in the four supported
  interface languages.
- The renderer sends the resolved language and translated labels to Electron
  after interface-language initialization and whenever the language changes.
- The existing `open-settings` browser event remains the single entry point for
  opening Global Settings from renderer UI or native menu commands.

## Required menu surface

- Application: About, Check for Updates, Settings, standard macOS Services,
  Hide, Hide Others, Show All, and Quit actions.
- File: New Window and Close Window.
- Edit: standard Undo, Redo, Cut, Copy, Paste, Paste and Match Style, Delete,
  and Select All roles.
- View: zoom and full-screen controls. Reload and developer tools are available
  only in development mode.
- Window: Minimize, Zoom, and Bring All to Front.
- Help: the existing Gnosi documentation destination.

## Window lifecycle

Track every Gnosi main window explicitly. New Window creates an independent
renderer window against the same local backend. Closing the last window keeps
the app and backend alive on macOS. The Dock activation event and native menu
commands recreate a window when none remains. Renderer-bound commands select a
focused Gnosi main window, fall back to the most recent one, or create one and
wait for it to finish loading.

## Validation

- Unit-test menu translation normalization, menu shape, production exclusion of
  development actions, settings delivery, and multi-window lifecycle helpers.
- Build the frontend so i18n completeness and release catalog checks run.
- Launch the desktop app in development mode and inspect the native menu,
  Settings command, New Window, Close Window, and Dock reactivation behavior.

## Restrictions and edge cases

- Do not rely on Electron's default menu: it is English, exposes development
  commands in production, and does not model Gnosi's settings surface.
- Do not derive the native menu language only from the operating system: the
  user-selected Gnosi language is authoritative.
- Do not let a closed older window clear or replace the reference to a newer
  window: keep an explicit set and remove only the window that emitted `closed`.
- Do not send Settings before a newly created renderer has loaded: queue the
  command on `did-finish-load`.
- Do not duplicate translated strings in the Electron process: use the four
  frontend locale catalogs and validate the renderer payload at the IPC
  boundary.
