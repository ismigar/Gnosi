import { useRef } from 'react';
import { fetchAiModels, updateAiModels, type AiModelRegistryEntry } from '../../../shared/api/ai';
import type { ModelRegistryState } from '../modelComparison';

/** Serialize edits and re-read persisted configuration before each change. */
export function useRegistryMutation(onSaved: (registry: ModelRegistryState) => void) {
    const pending = useRef<Promise<void>>(Promise.resolve());
    return (change: (models: readonly AiModelRegistryEntry[]) => readonly AiModelRegistryEntry[], isCurrent = () => true) => {
        const operation = pending.current.then(async () => {
            if (!isCurrent()) return;
            const latest = await fetchAiModels();
            if (!isCurrent()) return;
            const models = [...change(latest.configured_models)];
            await updateAiModels({ models, budget: latest.budget,
                ...(latest.revision ? { expected_revision: latest.revision } : {}),
            });
            onSaved({ models, budget: latest.budget });
        });
        pending.current = operation.catch(() => undefined);
        return operation;
    };
}
