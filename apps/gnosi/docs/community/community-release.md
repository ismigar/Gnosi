# Gnosi community release kit

[English](community-release.md) · [Català](community-release.ca.md) · [Español](community-release.es.md)

These texts are ready to adapt or publish. Replace only the bracketed optional
context; keep the beta and unsigned-build disclosure.

## Main announcement

### Gnosi: from source to manuscript, with your knowledge always yours

I built Gnosi because my research workflow was split across Notion, Obsidian
and Mendeley. Notion gave me databases and project views, Obsidian gave me
Markdown and a knowledge graph, and Mendeley managed references. The same
sources and ideas had to exist in several places, while years of work depended
on closed products and policies I could not control.

Gnosi is my open-source answer: a local-first research workspace that connects
references, PDF/EPUB/web evidence, notes, structured views, a knowledge graph
and verifiable citations. The underlying knowledge remains in ordinary
Markdown and YAML files.

The primary workflow is deliberately simple:

1. Capture or import a source.
2. Read and preserve exact evidence and provenance.
3. Connect reading notes into your own synthesis.
4. Cite the result in Gnosi, Word or LibreOffice.

The desktop app is available for macOS, Windows and Linux. It is still beta and
the builds are currently unsigned, so please read the installation note on the
release page. Gnosi can also run natively or through the supported Docker
deployment.

Download: https://github.com/ismigar/Gnosi/releases/latest

Source and documentation: https://github.com/ismigar/Gnosi

If you try it, I am especially interested in where this chain breaks: install,
source import, evidence traceability, synthesis or citation.

## Short social post

I built Gnosi to stop duplicating research across Notion, Obsidian and
Mendeley. It connects sources → evidence → notes → citations while keeping the
knowledge in local Markdown/YAML files. Open source, local-first, desktop and
self-hosted. Beta builds are currently unsigned.

https://gnosi.temenosismael.org/

## Research-community post

### An open source, local-first workspace for source-to-manuscript research

Gnosi may be useful if your actual workflow crosses a reference manager, a
Markdown notebook, project tables and Word or LibreOffice.

It combines DOI/ISBN/arXiv/PMID and BibTeX/RIS import, a PDF/EPUB reader,
evidence-preserving annotations, connected Markdown notes, typed database
views, a knowledge graph, CSL citations and Word/LibreOffice add-ins. AI is
optional and can use local or cloud providers; provenance stays visible.

The project is AGPL-3.0-or-later and the Vault remains ordinary files. An
official signed template demonstrates the workflow in English, Catalan and
Spanish without requiring an AI provider.

This is a personal tool shared with the community, not a claim to replace every
research system. I would value feedback based on a real source and a real piece
of writing.

Project: https://github.com/ismigar/Gnosi

## Feedback request

Thank you for trying Gnosi. Four concrete answers are more useful than a general
rating:

1. Could you install and open it?
2. Could you bring in one real source?
3. Could you trace a reading or synthesis note back to its evidence?
4. Could you insert or export the citation?

Please include your operating system, the step that blocked you and what you
expected to happen. Never attach private research material to a public issue.

Feedback issue: https://github.com/ismigar/Gnosi/issues/new?labels=feedback&title=%5BFeedback%5D%20My%20first%20Gnosi%20workflow

## Frequently asked questions

### Is Gnosi another Notion or Obsidian clone?

No. Their editor, database and graph ideas are part of the background, but
Gnosi's primary path is the research chain from a source and exact evidence to
connected synthesis and a verifiable citation.

### Does it replace Zotero or Mendeley?

Gnosi has a native reference manager and Zotero-compatible web capture, but it
also supports open exchange through BibTeX and RIS. The goal is to remove
duplication and preserve interoperability, not to make existing libraries
hostage to a new format.

### Is AI required?

No. The research template and the core source-to-citation workflow work without
an AI provider. When enabled, AI may use local or cloud models.

### Where is the data stored?

The Vault is a folder of Markdown, YAML and regular assets. Local rebuildable
indexes improve speed; they are not the source of truth.

### Is it ready for a research group?

Personal mode is the mature primary path. Organization mode, roles and live
presence exist, but full real-time collaborative editing is still early. Test
group use before relying on it for critical shared work.

### Why does macOS warn when opening the app?

Current beta desktop builds are unsigned. Use right-click → Open for the first
launch and verify that the download came from the official GitHub Releases
page. Signing and notarization remain distribution work.

