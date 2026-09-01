import { createReactBlockSpec } from '@blocknote/react';
import { Info } from 'lucide-react';
import { InlineDatabase } from './InlineDatabase';
import { TransclusionEmbed } from './TransclusionEmbed';
import { DbViewEmbed } from '../../views/DbViewEmbed';
import { EmbedRenderer } from '../EmbedRenderer';
import { BibliographyBlock } from '../BibliographyBlock';
import TableOfContentsBlock from '../TableOfContentsBlock';
import MermaidBlock from '../MermaidBlock';
import LinkCardBlock from '../LinkCardBlock';
import SyncedBlock from '../SyncedBlock';

export function createBlockSpecs() {
    return {
            database: createReactBlockSpec({
                type: "database",
                propSchema: { database_table_id: { default: "" }, viewId: { default: "" }, filters: { default: "" }, sort: { default: "" }, search: { default: "" }, visibleProperties: { default: "" }, viewType: { default: "table" } },
                content: "none",
            }, { render: (props) => <InlineDatabase block={props.block} onUpdateTable={id => { props.editor.updateBlock(props.block, { props: { ...props.block.props, database_table_id: id } }); }} /> }),
            gnosi_view: createReactBlockSpec({
                type: "gnosi_view",
                propSchema: { view_id: { default: "" }, heading: { default: "" }, heading_level: { default: "1" }, section: { default: "" } },
                content: "none",
            }, { render: (props) => <DbViewEmbed block={props.block} /> }),
            transclusion: createReactBlockSpec({
                type: "transclusion",
                propSchema: { target: { default: "" }, alias: { default: "" }, section: { default: "" } },
                content: "none",
            }, { render: (props) => <TransclusionEmbed block={props.block} /> }),
            embed: createReactBlockSpec({
                type: "embed",
                propSchema: { url: { default: "" }, caption: { default: "" } },
                content: "none",
            }, { render: (props) => <EmbedRenderer block={props.block} editor={props.editor} /> }),
            // Block that renders the document's bibliography based on the
            // `[@key]` citations it contains. See BibliographyBlock.jsx.
            bibliography: createReactBlockSpec({
                type: "bibliography",
                propSchema: {
                    style: { default: "apa" },
                    locale: { default: "en-US" },
                },
                content: "none",
            }, { render: (props) => <BibliographyBlock block={props.block} editor={props.editor} /> }),
            // NOTE: the `:::toggle` fence is mapped to BlockNote's built-in
            // `toggleListItem` (see markdown-mapper.js + slashMenuUtils.js), not
            // a custom spec. We previously had a custom `toggle` block here, but
            // its render never wired up a container for the child blocks, so it
            // was impossible to write inside the toggle. `toggleListItem` uses
            // BlockNote's own `createToggleWrapper` (the vanilla, working one),
            // which renders the indented children as an editable container.
            alert: createReactBlockSpec({
                type: "alert",
                propSchema: {
                    type: { default: "info", values: ["info", "warning", "error", "success"] },
                },
                content: "none",
            }, {
                render: (props) => (
                    <div
                        className={`bn-alert bn-alert-${props.block.props.type}`}
                        aria-hidden="true"
                    >
                        <Info size={17} strokeWidth={2} />
                    </div>
                )
            }),
            // Table of contents generated from the document's headings (`{{toc}}`).
            tableOfContents: createReactBlockSpec({
                type: "tableOfContents",
                propSchema: {},
                content: "none",
            }, { render: (props) => <TableOfContentsBlock editor={props.editor} /> }),
            // Mermaid diagram; saved as a ```mermaid fence.
            mermaid: createReactBlockSpec({
                type: "mermaid",
                propSchema: { code: { default: "" } },
                content: "none",
            }, { render: (props) => <MermaidBlock block={props.block} editor={{ updateBlock: (_block, update) => props.editor.updateBlock(props.block, update) }} /> }),
            // Link preview card (OG); `[bookmark: URL](URL)`.
            linkcard: createReactBlockSpec({
                type: "linkcard",
                propSchema: { url: { default: "" } },
                content: "none",
            }, { render: (props) => <LinkCardBlock block={props.block} /> }),
            // Bidirectional synced block; ```gnosi-synced fence with sync_id.
            synced: createReactBlockSpec({
                type: "synced",
                propSchema: { sync_id: { default: "" } },
                content: "none",
            }, { render: (props) => <SyncedBlock block={props.block} /> }),
            // Obsidian-style inline footnote (`text[^1]` + `[^1]: definition`).
    };
}
