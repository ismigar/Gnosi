import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AIQualitySettingsPanel } from './AIQualitySettings';


const mocks = vi.hoisted(() => ({
    addAssociation: vi.fn(),
    loadMemories: vi.fn(),
    runEvaluation: vi.fn(),
}));


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));
vi.mock('../../../shared/notifications/notifyError', () => ({ logError: vi.fn() }));
vi.mock('../../../shared/notifications/toast', () => ({
    toast: { error: vi.fn(), success: vi.fn() },
}));


const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;


const setInputValue = (input: HTMLInputElement, value: string): void => {
    const descriptor = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
    );
    if (!descriptor?.set) throw new Error('Native input setter is unavailable');
    descriptor.set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
};


let container: HTMLDivElement;
let root: Root;


beforeEach(() => {
    vi.resetAllMocks();
    mocks.addAssociation.mockResolvedValue({});
    mocks.loadMemories.mockResolvedValue([]);
    mocks.runEvaluation.mockResolvedValue({});
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});


afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
});


describe('AIQualitySettingsPanel', () => {
    it('coordinates agent quality, memory, evaluation, and vocabulary actions', async () => {
        const resources = {
            addSemanticAssociation: mocks.addAssociation,
            agentMemories: [{
                category: 'preference',
                memory_id: 'memory-1',
                text: 'Prefer primary sources',
            }],
            capabilityConformance: { counts: { pass: 3, partial: 1, legacy: 0 } },
            loadAgentMemories: mocks.loadMemories,
            loading: false,
            modelEvaluations: [],
            qualityDashboard: {
                capabilities: [{
                    capability_id: 'reader.search',
                    status: 'healthy',
                    successes: 4,
                }],
                quality: { completed_turns: 7 },
            },
            reload: vi.fn().mockResolvedValue({}),
            removeAgentMemory: vi.fn().mockResolvedValue({}),
            removeSemanticAssociation: vi.fn().mockResolvedValue({}),
            runModelEvaluation: mocks.runEvaluation,
            saveAgentMemory: vi.fn().mockResolvedValue({}),
            semanticAssociations: [],
        };

        await act(async () => {
            root.render(
                <AIQualitySettingsPanel
                    agents={[{ id: 'brain', name: 'Brain' }]}
                    resources={resources}
                />,
            );
            await Promise.resolve();
        });

        expect(mocks.loadMemories).toHaveBeenCalledWith('brain');
        expect(container.textContent).toContain('Prefer primary sources');
        expect(container.textContent).toContain('reader.search');

        const evaluationButton = [...container.querySelectorAll('button')]
            .find((button) => button.textContent.includes('run_evaluation'));
        if (!evaluationButton) throw new Error('Evaluation action was not rendered');
        await act(async () => {
            evaluationButton.click();
            await Promise.resolve();
        });
        expect(mocks.runEvaluation).toHaveBeenCalledWith('brain');

        const associationInputs = container.querySelectorAll<HTMLInputElement>(
            '.ai-resource-editor__grid input',
        );
        const triggerInput = associationInputs.item(0);
        const relatedInput = associationInputs.item(1);
        act(() => {
            setInputValue(triggerInput, 'Topic');
            setInputValue(relatedInput, ' one, two ');
        });
        const associationEditor = triggerInput.closest('.ai-resource-editor');
        const addButton = associationEditor?.querySelector<HTMLButtonElement>('button');
        if (!addButton) throw new Error('Association action was not rendered');
        await act(async () => {
            addButton.click();
            await Promise.resolve();
        });

        expect(mocks.addAssociation).toHaveBeenCalledWith('Topic', ['one', 'two']);
    });
});
