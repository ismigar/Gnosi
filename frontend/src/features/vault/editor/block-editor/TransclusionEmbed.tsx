import { forwardRef, useContext, useMemo } from 'react';
import { VaultEditorContext } from '../../../../shared/editor/VaultEditorContext';
import { VaultTransclusion } from '../../../../shared/editor/vault-markdown/VaultTransclusion';
import { transclusionKey } from '../../../../shared/editor/vault-markdown/transclusionModel';
import { TransclusionContent } from './TransclusionContent';

interface TransclusionProps { readonly block: { readonly props: { readonly target?: string; readonly alias?: string; readonly section?: string } }; }

export const TransclusionEmbed = forwardRef<HTMLDivElement, TransclusionProps>(({ block }, ref) => {
    const context = useContext(VaultEditorContext);
    const section = (block.props.section || '').trim();
    const ancestry = useMemo(() => context.transclusionAncestors ?? (context.pageId ? [transclusionKey(context.pageId)] : []), [context.pageId, context.transclusionAncestors]);
    return <VaultTransclusion
        containerRef={ref}
        editable={context.isEditable !== false}
        target={(block.props.target || '').trim()}
        alias={(block.props.alias || '').trim()}
        section={section}
        idToTitle={context.idToTitle}
        sourcePageId={context.pageId}
        ancestry={ancestry}
        onOpenInCurrentTab={context.onOpenInCurrentTab ?? context.onOpenPage ?? undefined}
        onOpenInNewTab={context.onOpenInNewTab ?? undefined}
        onOpenParallel={context.onOpenParallel ?? undefined}
        renderContent={({ page, ancestry: path, requestContext }) => <TransclusionContent
            key={`${JSON.stringify(requestContext)}#${page.id}#${section}`}
            page={page} section={section} requestContext={requestContext}
            context={{ ...context, pageId: page.id, transclusionAncestors: path }}
        />}
    />;
});
TransclusionEmbed.displayName = 'TransclusionEmbed';
