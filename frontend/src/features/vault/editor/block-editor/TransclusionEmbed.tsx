import { forwardRef } from 'react';
import { VaultMarkdownTransclusion } from '../../../../shared/editor/VaultMarkdown';

interface TransclusionProps {
    readonly block: { readonly props: { readonly target?: string; readonly alias?: string; readonly section?: string } };
}

export const TransclusionEmbed = forwardRef<HTMLDivElement, TransclusionProps>(({ block }, ref) => (
    <VaultMarkdownTransclusion
        ref={ref}
        target={(block.props.target || '').trim()}
        alias={(block.props.alias || '').trim()}
        section={(block.props.section || '').trim()}
    />
));
TransclusionEmbed.displayName = 'TransclusionEmbed';
