# Directive: Gnosi Design System 10/10

## Objective

Transform every Gnosi route and global surface into one coherent, compact,
accessible, responsive product without reducing functionality.

The authoritative implementation is
`monorepo/apps/gnosi/frontend/src/`. Native Vite on port 5173 is the default
runtime. Docker remains a supported deployment mode and must not receive
environment-specific frontend assumptions.

## Product principles

- Functional minimalism takes precedence over decorative minimalism.
- One application shell, page-header model, spacing scale, radius scale, shadow
  scale, and layer registry must govern every route.
- Permanent panels must earn their space. Secondary panels collapse
  automatically as the viewport narrows and become drawers on mobile.
- Desktop productivity and keyboard workflows remain first-class.
- Mobile layouts must be complete workflows, not clipped desktop layouts.
- Every user-visible string, tooltip, empty state, loading state, accessible
  name, and error uses i18n with parity across Catalan, English, Spanish, and
  French.
- Theme-aware surfaces use shared variables. Feature routes must not impose a
  permanent light or dark theme.
- Loading preserves application context and communicates what is happening.

## Required shared primitives

- Application shell with accessible global navigation and a working mobile
  drawer.
- Shared page header with a compact title, optional subtitle, active vault
  badge, responsive actions, and consistent height.
- Shared buttons, icon buttons, badges, panels, empty states, skeletons, and
  responsive split-view behavior.
- Centralized design tokens for spacing, radii, shadows, control sizes,
  content widths, and layers.
- A floating-action dock that owns chat, meeting recorder, page outline, and
  any future global launcher without overlapping application controls.

## Responsive requirements

- At 390 pixels, global navigation is reachable, all primary actions are
  visible, no workflow has horizontal page scrolling, and tap targets are at
  least 44 pixels.
- At 768 pixels, split views use one primary surface plus explicit drawers or
  back navigation.
- At 1280 pixels, side panels remain compact and the primary task receives the
  majority of the viewport.
- Settings uses navigation-first mobile flow and never displays its 280-pixel
  desktop sidebar beside a narrow content sliver.
- Calendar, Contacts, Mail, Reader, Media, Graph, and Vault define explicit
  responsive panel behavior instead of relying on overflow clipping.

## Visual coherence requirements

- Home, Dashboard, Composer, Scheduler, Planning, Graph, Contacts, Calendar,
  Reader, Mail, Social, Media, Vault, shared pages, and Settings use the same
  shell language and theme behavior.
- Decorative glows, glass effects, large shadows, and oversized cards are
  limited to intentional emphasis and do not define isolated route themes.
- Header titles, vault badges, uppercase metadata, icon sizing, control
  heights, and empty-state geometry are consistent.
- Route-specific brand colors may identify content but must use shared
  semantic tokens.

## Layer and overlay requirements

- Use the registered layer variables from `index.css`.
- Global launchers sit below modal overlays.
- Modal children use the modal-dropdown layer and confirmations use the
  confirmation layer.
- No component may use arbitrarily large layer values or browser-maximum layer
  hacks.
- Browser QA must prove that Settings, confirmations, pickers, toasts, chat,
  recorder, and page outline never obscure one another incorrectly.

## Accessibility requirements

- Modal surfaces expose dialog semantics, a usable accessible name, focus
  containment, Escape behavior, and focus restoration.
- Icon-only controls have translated accessible names and visible focus states.
- Navigation remains operable with keyboard and touch.
- Text and interactive states meet WCAG AA contrast.
- Reduced-motion preferences remove nonessential transforms and animation.

## Loading and failure requirements

- Route loading uses a shell-preserving skeleton rather than a blank page.
- Data loading has contextual skeletons or empty states.
- Independent data sources do not keep an entire route loading indefinitely.
- Failed or slow integrations expose recovery actions without blocking other
  available content.

## Implementation order

1. Shared tokens, shell, header, responsive helpers, floating-action dock, and
   layer cleanup.
2. Settings, Home, Dashboard, Composer, Scheduler, and Planning.
3. Vault, Contacts, Calendar, Reader, Mail, Social, Media, and Graph.
4. Shared pages, modals, empty states, loading states, accessibility, and i18n
   parity.
5. Visual regression coverage and complete native QA.

## Verification gates

- Frontend build succeeds with zero errors.
- Frontend lint and relevant unit tests pass.
- Locale catalogs parse and all referenced static keys exist in every locale.
- Browser QA passes at 390 by 844, 768 by 1024, and 1280 by 720.
- Home, Vault, Calendar, Contacts, Mail, Reader, Dashboard, Planning,
  Composer, Social, Media, Graph, Settings, and at least one populated Vault
  document are visually inspected.
- Light and dark themes preserve hierarchy and contrast.
- No global horizontal overflow exists at the tested breakpoints.
- The global navigation works on desktop, keyboard, and mobile.
- Automated visual regression includes representative routes at desktop and
  mobile sizes.

## Restrictions and edge cases

- Do not remove advanced capabilities merely to make the interface appear
  simpler. Use progressive disclosure.
- Do not hard-code route-specific theme backgrounds or active-vault labels.
- Do not replace meaningful desktop density with oversized touch spacing.
- Do not introduce a second design library or duplicate existing primitives.
- Preserve unrelated worktree changes and current Settings improvements.
- If a route cannot load because one integration is unavailable, keep the
  route usable and document the integration-specific failure.
- Do not apply opacity to a complete glass surface because it also reduces text
  and control contrast. Mix transparency into the background color instead.
- Do not place mobile primary actions after a long, scrollbar-free tab strip.
  Give critical actions their own visible row while tabs may scroll
  independently.
- Do not assume the first render has desktop geometry. Initialize compact
  behavior from `matchMedia`, and verify it again after a hard route load at
  every supported breakpoint.
- Do not lint generated Vite bundles or vendored reader distributions. Ignore
  `.vite/`, `dist/`, `vendor/`, and `public/zotero-reader/`; lint application
  sources and maintained public integrations.
- The repository-wide lint baseline currently contains legacy errors in
  Office globals, historical hook patterns, and unrelated feature modules.
  Design-system work must pass lint on every newly created or substantively
  edited shared file and must not hide the baseline by weakening rules.
- Native route chunks and OneDrive-backed Vault data may need more than the
  nominal visual-test delay on a cold load. Keep contextual loading visible,
  wait for the route-specific ready state before manual screenshots, and never
  replace the native runtime with Docker for local QA.
