import { useEffect, useState } from 'react';
import axios from '../shared/api/legacy-http';

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
        let alive = true;
        axios.get('/api/ai/model-reliability')
            .then(res => { if (alive) setRows(res.data?.models || []); })
            .catch(err => console.error('Could not load model reliability', err));
        return () => { alive = false; };
    }, []);

    return rows;
}

/** The row for one model, only when the evidence is about the model itself. */
export function findModelFault(rows, provider, modelId) {
    const row = (rows || []).find(r => r.provider === provider && r.model_id === modelId);
    return row?.top_model_reason ? row : null;
}
