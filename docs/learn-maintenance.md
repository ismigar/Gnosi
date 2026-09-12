# Maintaining user help

The user help source is `docs/learn/{en,ca,es,fr}`. These are reviewed task
instructions, not generated API documentation. `desktop/help-links.json` owns
the public base paths, supported locales, article slugs and app-section mapping.
The web and desktop clients consume that catalog. Keep slugs and explicit section
IDs stable so language changes and existing help links retain their destination.

Update all four translations together when a user workflow changes. Check the
actual interface, plugin prerequisites and operation outcomes. Use fictional
examples; do not describe a roadmap capability as available. The initial guides
were checked against the README, the frontend feature owners and the engineering
domain guides for Vault/files, views/planning, genograms, reader/references,
notebooks, agents, mail, calendar, contacts, social publishing, integrations,
workspaces and scheduling. Screenshots are optional and must use disposable data.

Run `python scripts/check_learn.py`, then build the four `mkdocs-learn*.yml`
configurations in English, Catalan, Spanish, French order using the docs Python
environment. English writes `site/learn`; translations write its locale children.
Never run an English clean build after the translated builds. Engineering has its
own output directory and is built first by the documentation workflow.

Preview the combined artifact under `/Gnosi/` to match GitHub Pages. Check a
desktop and narrow viewport, search for a phrase from a guide, follow a result,
switch language within the article, and check its section link. In the app, check
Help using keyboard and pointer on both the legacy and canonical Vault routes.

## Publication order

1. Publish the documentation artifact from the Gnosi documentation workflow.
2. Verify `/Gnosi/learn/`, its three locale roots and a localized article/search
   index on the public host.
3. Publish the website entry redirects and navigation from `ismigar.github.io`.
   The four `/learn/` entry pages preserve query and fragment when redirecting.
4. Only then distribute a desktop build or app deployment with the help menu.

No app release is produced by the documentation workflow. If publication fails,
leave the currently published app release in place and rerun the documentation
workflow after resolving the failure. The help site needs no new backend, login,
AI provider or analytics service.

Help links from the sidebar carry the Gnosi appearance preference in the `theme` query parameter (light, dark or system). The portal preserves it in article and language navigation. Direct visits use the same-origin Gnosi `db-theme` setting when available, otherwise the system preference. The help template owns the palette so Material does not override an explicit Gnosi theme.
