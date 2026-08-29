import { useEffect, useState } from 'react';
import { fetchAiModelReliability } from '../shared/api/ai';

/**
 * Recorded failures per model, by reason.
 *
 * Evidence, not policy: nothing here disables or reroutes a model. Only the
 * reasons the backend attributes to the MODEL reach the UI — a rate limit or an
 * empty account says nothing about how good a model is at calling tools.
 * The taxonomy lives in `backend/agent/model_reliability.py`.
 */

/** i18n key + fallback per reason the backend blames on the model. */
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
};

export function useModelReliability() {
    const [rows, setRows] = useState([]);

    useEffect(() => {
        const controller = new AbortController();
        fetchAiModelReliability(30, controller.signal)
            .then(data => {
                if (!controller.signal.aborted) setRows(data?.models || []);
            })
            .catch(err => {
                if (!controller.signal.aborted) {
                    console.error('Could not load model reliability', err);
                }
            });
        return () => controller.abort();
    }, []);

    return rows;
}

/** The row for one model, only when the evidence is about the model itself. */
export function findModelFault(rows, provider, modelId) {
    const row = (rows || []).find(r => r.provider === provider && r.model_id === modelId);
    return row?.top_model_reason ? row : null;
}
