import { createReactInlineContentSpec } from '@blocknote/react';
import type { VaultEditorContextValue } from '../VaultEditorContext';
import { WikilinkInline } from '../WikilinkInline';
import { CiteInline } from '../CiteInline';
import FootnoteInline from '../FootnoteInline';
import MentionInline from '../MentionInline';
import DateMentionInline from '../DateMentionInline';
import { IconRenderer } from '../IconRenderer';
import { footnoteDocument } from './footnoteDocument';

export function createInlineSpecs(contextValue: VaultEditorContextValue) {
    return {
            wikilink: createReactInlineContentSpec({
                type: "wikilink",
                propSchema: {
                    title: { default: "" },
                    target: { default: "" },
                },
                content: "none",
            }, {
                render: (props) => (
                    <WikilinkInline
                        title={props.inlineContent.props.title}
                        target={props.inlineContent.props.target}
                        idToTitle={contextValue.idToTitle}
                        onOpenInCurrentTab={contextValue.onOpenInCurrentTab}
                        onOpenInNewTab={contextValue.onOpenInNewTab || contextValue.onOpenPage}
                        onOpenParallel={contextValue.onOpenParallel}
                    />
                )
            }),
            // Citation `[@key]`: clickable chip that links to an entry
            // from Resources by its `Citation Key` field. See CiteInline.jsx
            // for the render and async resolution via /api/vault/resolve-by-citation-key.
            cite: createReactInlineContentSpec({
                type: "cite",
                propSchema: {
                    citationKey: { default: "" },
                },
                content: "none",
            }, {
                render: (props) => (
                    <CiteInline citationKey={props.inlineContent.props.citationKey} />
                )
            }),
            footnote: createReactInlineContentSpec({
                type: "footnote",
                propSchema: { id: { default: "" }, content: { default: "" } },
                content: "none",
            }, {
                render: (props) => (
                    <FootnoteInline
                        inlineContent={props.inlineContent}
                        updateInlineContent={props.updateInlineContent}
                        editor={{ get document() { return footnoteDocument(props.editor.document); } }}
                    />
                )
            }),
            // Mention of a person (contact): `@[Name|id]`.
            mention: createReactInlineContentSpec({
                type: "mention",
                propSchema: { id: { default: "" }, name: { default: "" } },
                content: "none",
            }, { render: (props) => <MentionInline inlineContent={props.inlineContent} /> }),
            // Date mention / inline reminder: `@2026-06-25` or `@2026-06-25T09:00`.
            dateref: createReactInlineContentSpec({
                type: "dateref",
                propSchema: { date: { default: "" }, time: { default: "" } },
                content: "none",
            }, {
                render: (props) => (
                    <DateMentionInline
                        inlineContent={props.inlineContent}
                        updateInlineContent={props.updateInlineContent}
                    />
                )
            }),
            inlineIcon: createReactInlineContentSpec({
                type: "inlineIcon",
                propSchema: { value: { default: "" } },
                content: "none",
            }, {
                render: (props) => (
                    <span
                        className="inline-flex align-text-bottom mx-0.5"
                        data-gnosi-inline-icon={props.inlineContent.props.value}
                    >
                        <IconRenderer icon={props.inlineContent.props.value} size={18} />
                    </span>
                )
            })
    };
}
