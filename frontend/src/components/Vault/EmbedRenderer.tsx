import { forwardRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  EmptyEmbed,
  MissingEmbed,
  ResolvedEmbed,
} from './embed-renderer/EmbedRendererStates';
import {
  detectEmbedKind,
  normalizeEmbedUrl,
  readEmbedBlockText,
  type EmbedRendererProps,
} from './embed-renderer/embedRendererModel';
import { useEmbedRendererController } from './embed-renderer/useEmbedRendererController';


export const EmbedRenderer = forwardRef<HTMLDivElement, EmbedRendererProps>(
  function EmbedRendererComponent({ block, editor }, ref) {
    const { t } = useTranslation();
    const { caption, rawUrl } = readEmbedBlockText(block);
    const url = useMemo(() => normalizeEmbedUrl(rawUrl), [rawUrl]);
    const kind = useMemo(() => detectEmbedKind(url), [url]);
    const { availability, openPicker } = useEmbedRendererController({
      block,
      caption,
      editor,
      url,
    });

    if (availability === 'missing') {
      return (
        <MissingEmbed
          rootRef={ref}
          rawUrl={rawUrl}
          onRelink={() => {
            void openPicker('local');
          }}
          t={t}
        />
      );
    }

    if (!rawUrl) {
      return (
        <EmptyEmbed
          rootRef={ref}
          onPickVault={() => {
            void openPicker('vault');
          }}
          onPickUrl={() => {
            void openPicker('url');
          }}
          t={t}
        />
      );
    }

    return (
      <ResolvedEmbed
        rootRef={ref}
        caption={caption}
        kind={kind}
        onChange={() => {
          void openPicker('vault');
        }}
        t={t}
        url={url}
      />
    );
  },
);


EmbedRenderer.displayName = 'EmbedRenderer';
