import { useEffect, useState } from 'react';

import {
  fetchAiModelReliability,
  type AiModelReliability,
} from '../shared/api/ai';


export const MODEL_FAULT_REASONS = {
  tool_use_failed: {
    key: 'settings.ai.reliability_tool_use_failed',
    fallback: 'made malformed tool calls',
  },
  context_length_exceeded: {
    key: 'settings.ai.reliability_context_length',
    fallback: 'ran out of context window',
  },
  schema_invalid: {
    key: 'settings.ai.reliability_schema_invalid',
    fallback: 'did not follow the requested format',
  },
  content_filter: {
    key: 'settings.ai.reliability_content_filter',
    fallback: 'was blocked by content filters',
  },
} as const;


export type ModelReliabilityRow = AiModelReliability['models'][number];


export function useModelReliability(): ModelReliabilityRow[] {
  const [rows, setRows] = useState<ModelReliabilityRow[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetchAiModelReliability(30, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setRows(data.models);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error('Could not load model reliability', error);
        }
      });
    return () => {
      controller.abort();
    };
  }, []);

  return rows;
}


/** The row for one model, only when the evidence is about the model itself. */
export function findModelFault(
  rows: readonly ModelReliabilityRow[] | null | undefined,
  provider: string,
  modelId: string,
): ModelReliabilityRow | null {
  const row = (rows ?? []).find(
    (candidate) => candidate.provider === provider && candidate.model_id === modelId,
  );
  return row?.top_model_reason ? row : null;
}
