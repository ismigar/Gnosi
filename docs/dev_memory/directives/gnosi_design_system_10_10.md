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
- Do not snapshot cold-route fallbacks or live volatile data. Visual regression
  suites pin the language and theme, wait for route-specific ready selectors,
  and mask only data-dependent regions while leaving the application shell and
  primary controls exposed.
- Do not assume typography utilities applied to editable form controls survive
  the compiled cascade. Page-title controls use the semantic
  `.vault-page-title` contract, and browser QA verifies their computed size and
  weight against the editor heading scale.
- Do not repeat the only available view label below a page title. Single-view
  databases retain the add-view control while omitting the redundant tab.
- Do not let feed metadata or previews dominate mobile cards. Show a small
  property sample and a measured text excerpt, with translated controls that
  progressively reveal the complete content.
- Global launchers share one safe-area dock and their panels are mutually
  exclusive. Independent fixed offsets cause launchers and panels to obscure
  one another and must not be reintroduced.
- Do not carry desktop document padding into nested mobile views because it
  starves cards and embeds of readable width. Compact pages reduce nested
  padding, omit the current-page breadcrumb and single-tab label, and place
  collapsed summary panels side by side only when enough width is available;
  expanded panels always receive the full row.
- At widths through 1023 pixels, Vault navigation is a drawer rather than a
  permanent column. A single open document has no document-strip row: its
  quick-open and close controls belong in the shell header. Feed cards use a
  768-pixel desktop reading column, compact timestamps, and bounded excerpt
  expansion with an explicit route to the full document. The floating dock is
  one collapsed launcher that reveals its independent actions only on demand.
- Image-based page icons retain their established size and use a visibly small
  top margin inside the shared icon frame, avoiding a broader header geometry
  change. On pages without a cover, the entire icon frame also sits 8 pixels
  lower so it does not visually attach to the document-strip edge.
- Bare pages without an icon reserve the cover-action row above the title
  actions and the hover-revealed icon frame; never let “add icon” or “add
  cover” controls overlap the title menu or title itself.
- Destructive page actions remain available while the active tab is ahead of
  the refreshed page index, but stay gated off for table and PDF tabs.
- Embedded database actions share one toolbar. Do not leave the add-view action
  on a visually empty single-view row, and never nest an interactive element
  inside another button; use a semantic split-button group.
- Mobile Vault icon controls use the shared 44-pixel touch size, including shell
  navigation, page actions, summary toggles, embedded-view actions, and feed
  controls. Reduce redundant chrome before shrinking a control below that size.
- Adjacent collapsed Vault summary panels share the same 44-pixel header height.
  Do not add vertical container padding around children that already use the
  touch-height control because it makes sibling panels visibly misalign.
- Nested mobile feed views remove both the embed padding and the feed's desktop
  inline padding. Keeping either layer makes a readable card materially narrower
  than the surrounding page summary.
- Every icon-removal and disclosure control needs a translated accessible name.
  A visible icon or a sibling text label does not name a separate button.
- Feed cards are semantic articles, not synthetic links containing checkboxes,
  disclosure buttons, Markdown links, and other interactive descendants. Use
  the record title as the single primary navigation control and name the
  selection checkbox with the record title.
- At widths below 360 pixels, the Vault shell exposes at most one applicable
  history direction alongside document actions. Rendering both disabled
  history buttons makes the left and right control groups overlap without
  producing detectable horizontal overflow.
- A mobile Vault drawer includes its own translated close control and Escape
  behavior. Its identity row reserves space for both the global navigation
  toggle and drawer close button; relying only on the backdrop leaves no clear
  way to exit and clips the active-vault label.
- Sidebar icon actions have translated names and use the shared small control
  size on desktop and touch size on mobile. An opacity-zero hover treatment
  does not excuse an unnamed or 18-pixel target.
- Development checkout warnings remain informative without displacing the
  product: use a one-line mobile summary, preserve the full message as
  supplementary text, and provide a translated dismiss action.
- Desktop page titles keep a stable primary action set. Favorite, comments,
  and active mode toggles may remain inline; destructive and secondary actions
  use progressive disclosure even when the pane is wide.
- Compact feed cards show at most three property pills and a short measured
  excerpt before disclosure. Compact summary panels replace long zero-heavy
  metadata strings with badges for nonzero counts.
- Bare Vault pages use a smaller icon and collapse cover-only geometry. Do not
  reserve covered-page vertical space when neither a cover nor its actions are
  visible.
- Embedded-view toolbars remain sticky within the document flow so record
  count, search, filters, and creation stay reachable while browsing long
  datasets.
- Vault sidebar section expansion is persisted as one version-tolerant local
  object. Secondary sections default closed; adding independent ad-hoc keys
  makes the navigation state inconsistent between sessions.
- Hover-only sidebar actions must also appear on `focus-within`, and every Vault
  icon action shares a visible theme-aware focus ring in both color schemes.
- Feed hierarchy prioritizes the record title over its timestamp and property
  pills without lowering secondary text below accessible contrast.
- Feed density is an explicit user preference stored independently for mobile
  and desktop. Responsive defaults must not overwrite a choice made for the
  other profile.
- Long document workflows retain context with a minimal sticky title/action
  header and sticky view controls; loading placeholders preserve the same
  toolbar-and-content geometry to avoid layout shifts.
- Active search and filter state remains visible beside its result count.
  Hidden configuration state without a visible chip makes filtered datasets
  look incomplete.
- Sidebar navigation can reveal and center the active page by expanding only
  its ancestor chain. Do not require users to manually reopen an entire tree
  to recover their current context.
- Variable-height feed cards use browser-native `content-visibility` together
  with progressive batching. Do not assume fixed row heights or unmount
  expanded cards, because that causes scroll jumps and loses local card state.
- Quick views are lightweight, page-and-view-scoped local presets. Persist only
  presentation state such as search, density, and active tab; server-backed
  filters remain part of the canonical view configuration.
- Contextual single-key shortcuts ignore editable controls and modified key
  combinations. Keep `/`, `F`, `N`, `D`, and `L` scoped to the active embedded
  view so normal typing and application shortcuts are unaffected.
- Compact page headers appear after the hero leaves its actual Vault document
  scroller and remain visible until the hero returns. Do not listen to every
  bubbling document scroll: nested database and picker scrolling must never
  hide the page header.
- The compact Vault row keeps the page icon, a flex-truncated title, properties
  and links toggles, and one overflow menu on the same line. Preserve 44-pixel
  touch targets at mobile widths and keep secondary page actions in that menu.
- On Dashboard table views, scrolling the table itself also promotes the
  compact row so the page identity and menu remain available; unrelated picker
  scrolling must not toggle the page header.
- Compact document-header Properties and Links buttons provide a hover/focus
  preview of their current content while retaining click-to-toggle panels and
  keyboard-accessible names; clicking either compact action also scrolls the
  page scroller to the top so the opened panel is immediately visible.
- Bare Vault hero actions sit outside the clipped cover surface and remain
  visible without requiring hover. Keep the icon below the shell header and
  reserve enough overview space to prevent it from touching the page title.
- Visual regression coverage for Vault pages includes mobile, tablet, and
  desktop viewports in both color schemes. Mask live feed content so snapshots
  detect layout regressions without becoming unstable from user data.
- Advanced feed controls live in one discoverable tools popover rather than
  expanding the primary toolbar. It contains shortcut help, quick-view
  management, grouping, focus, accessibility, and local performance feedback.
- Feed position and last-record recovery are local navigation aids. They do not
  mutate the canonical sort order and must tolerate records disappearing.
- Accessibility preferences for contrast and text scale persist locally and
  remain scoped to Vault page content; they must not silently restyle unrelated
  applications.
- Loading skeletons reflect the geometry of each view family. A table skeleton
  must not look like a feed, and live user data stays out of regression fixtures.
