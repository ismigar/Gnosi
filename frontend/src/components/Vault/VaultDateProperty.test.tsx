import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { parsePeriod, type PeriodInput } from '../../utils/projectPlanning';
import { VaultDateProperty } from './VaultDateProperty';
import type { VaultPlanningNote } from './vault-date-property/types';

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

interface MountedRoot {
    readonly container: HTMLDivElement;
    readonly root: Root;
}

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;
const translate = (key: string, fallback?: unknown): string => (
    typeof fallback === 'string' ? fallback : key
);

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate }),
}));

vi.mock('../../hooks/useLocaleSettings', () => ({
    useLocaleSettings: () => ({ dateLocale: 'en-US' }),
}));

const mountedRoots: MountedRoot[] = [];

const initialPeriod: ReturnType<typeof parsePeriod> = {
    version: 3,
    start: '2026-01-01T09:00',
    end: '2028-01-01T09:00',
    durationDays: 730,
    durationValue: 2,
    durationUnit: 'years',
    predecessorIds: ['predecessor'],
    dependencies: [{ predecessorId: 'predecessor', type: 'FS', lagMinutes: 0 }],
    startMode: 'manual',
    endMode: 'auto',
    mode: 'manual',
    constraintType: 'ASAP',
    constraintDate: '',
    deadline: '',
    percentComplete: 0,
    actualStart: '',
    actualEnd: '',
};

const notes = [
    {
        id: 'current',
        title: 'Current task',
        resolved_table_id: 'tasks',
        metadata: { table_id: 'tasks', Dates: initialPeriod },
    },
    {
        id: 'predecessor',
        title: 'Previous task',
        resolved_table_id: 'tasks',
        metadata: {
            table_id: 'tasks',
            Dates: {
                version: 3,
                start: '2025-01-01T09:00',
                end: '2025-12-31T09:00',
            },
        },
    },
] as const;

function PlanningPeriodFixture({
    initialValue = initialPeriod,
}: { readonly initialValue?: PeriodInput }) {
    const [period, setPeriod] = useState<PeriodInput>(initialValue);

    return (
        <VaultDateProperty
            type="period"
            value={period}
            onChange={setPeriod}
            fieldName="Dates"
            fieldConfig={{
                id: 'dates',
                period_unit: 'years',
                predecessors_enabled: true,
            }}
            noteId="current"
            notes={notes}
            idToTitle={{ predecessor: 'Previous task' }}
            planningEnabled
            planningSettings={{
                task_table_id: 'tasks',
                workday_start: '09:00',
                hours_per_day: 8,
                working_weekdays: [1, 2, 3, 4, 5],
            }}
        />
    );
}

function mount(node: ReactNode): MountedRoot {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const mounted = { root, container };
    mountedRoots.push(mounted);
    act(() => {
        root.render(node);
    });
    return mounted;
}

function requiredElement(container: ParentNode, selector: string): Element {
    const element = container.querySelector(selector);
    if (!element) throw new Error(`Missing test element: ${selector}`);
    return element;
}

function setInputValue(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
    )?.set?.bind(input);
    if (!setter) throw new Error('Missing native input value setter');
    setter(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeAll(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    while (mountedRoots.length > 0) {
        const mounted = mountedRoots.pop();
        if (!mounted) continue;
        act(() => {
            mounted.root.unmount();
        });
        mounted.container.remove();
    }
});

describe('VaultDateProperty scalar and recurrence contracts', () => {
    it('renders imported signed date values and emits the same scalar callback', () => {
        const value: unknown = { start: '-0044-03-15T09:00', extension: new Map() };
        const onChange = vi.fn<(value: PeriodInput) => void>();
        const { container } = mount(<VaultDateProperty type="datetime" value={value} onChange={onChange} />);
        const text = requiredElement(container, 'input[type="text"]');
        const hidden = requiredElement(container, 'input[type="datetime-local"]');
        if (!(text instanceof HTMLInputElement) || !(hidden instanceof HTMLInputElement)) {
            throw new Error('Expected date editors');
        }
        expect(text.value).toBe('-0044-03-15T09:00');
        expect(hidden.value).toBe('');
        act(() => { setInputValue(text, '-0043-03-15T10:30'); });
        expect(onChange.mock.calls).toEqual([['-0043-03-15T10:30']]);
    });

    it('renders unknown planning data and saves a concrete period without rewriting note metadata', () => {
        const extension = new Map([['retained', { nested: true }]]);
        const raw = { ...initialPeriod, start: '-2400-01-01T09:00', end: '-2398-01-01T09:00', extension };
        const value: unknown = raw;
        const metadata: Record<string, unknown> = { Dates: value, extension };
        const importedNotes: readonly VaultPlanningNote[] = [{ id: 'current', metadata }];
        const planningSettings: unknown = { workday_start: '09:00', extension };
        const onChange = vi.fn<(value: PeriodInput) => void>();
        const { container } = mount(<VaultDateProperty
            type="period" value={value} onChange={onChange} notes={importedNotes}
            planningEnabled planningSettings={planningSettings} fieldConfig={{ period_unit: 'years' }}
        />);
        expect(container.textContent).toContain('Start: -2400');
        expect(container.textContent).toContain('Finish: -2398');
        const duration = requiredElement(container, 'input[type="number"]');
        if (!(duration instanceof HTMLInputElement)) throw new Error('Expected duration input');
        act(() => { setInputValue(duration, '3'); });
        expect(onChange.mock.calls).toEqual([[{
            ...initialPeriod, start: '-2400-01-01T09:00', end: '-2397-01-01T09:00',
            durationValue: 3, durationDays: 1095,
        }]]);
        expect(metadata.Dates).toBe(raw);
        expect(metadata.extension).toBe(extension);
    });

    it('preserves local datetime values selected by the hidden picker', () => {
        const onChange = vi.fn<(value: PeriodInput) => void>();
        const { container } = mount(
            <VaultDateProperty
                type="datetime"
                value="2026-08-29T14:45"
                onChange={onChange}
            />,
        );
        const hidden = requiredElement(
            container,
            'input[type="datetime-local"]',
        );
        if (!(hidden instanceof HTMLInputElement)) {
            throw new Error('Expected datetime-local input');
        }

        act(() => {
            setInputValue(hidden, '2026-09-01T08:30');
        });

        expect(onChange).toHaveBeenCalledWith('2026-09-01T08:30');
    });

    it('keeps recurrence editing connected to the RRULE callback', () => {
        const onChange = vi.fn<(value: PeriodInput) => void>();
        const onRruleChange = vi.fn<(value: string | null) => void>();
        const { container } = mount(
            <VaultDateProperty
                value="2026-08-29"
                onChange={onChange}
                onRruleChange={onRruleChange}
            />,
        );
        const repeatButton = requiredElement(container, 'button[title="Repeat"]');
        if (!(repeatButton instanceof HTMLButtonElement)) {
            throw new Error('Expected recurrence button');
        }
        act(() => {
            repeatButton.click();
        });
        const recurrence = requiredElement(container, 'select');
        if (!(recurrence instanceof HTMLSelectElement)) {
            throw new Error('Expected recurrence selector');
        }

        act(() => {
            recurrence.value = 'DAILY';
            recurrence.dispatchEvent(new Event('change', { bubbles: true }));
        });

        expect(onRruleChange).toHaveBeenCalledWith('FREQ=DAILY');
    });

    it('recalculates the end of a legacy period from its inclusive day count', () => {
        const onChange = vi.fn<(value: PeriodInput) => void>();
        const { container } = mount(
            <VaultDateProperty
                type="period"
                value="2026-08-29/2026-08-30"
                onChange={onChange}
            />,
        );
        const days = requiredElement(container, 'input[type="number"]');
        if (!(days instanceof HTMLInputElement)) {
            throw new Error('Expected period day input');
        }

        act(() => {
            setInputValue(days, '4');
        });

        expect(onChange).toHaveBeenCalledWith('2026-08-29/2026-09-01');
    });
});

describe('VaultDateProperty planning constraints', () => {
    it('keeps codes in the selector and guides date-based rules contextually', async () => {
        const { container } = mount(<PlanningPeriodFixture />);
        const summary = requiredElement(
            container,
            'section[aria-label="Calculation summary"]',
        );
        expect(summary.textContent).toContain('Start: 2026');
        expect(summary.textContent).toContain('Duration: 2 years');
        expect(summary.textContent).toContain('Finish: 2028');
        expect(summary.textContent).not.toContain('Automatic start from');

        const ruleSelect = [...container.querySelectorAll('select')]
            .find((select) => select.querySelector('option[value="SNET"]'));
        if (!ruleSelect) throw new Error('Missing scheduling rule selector');
        expect([...ruleSelect.options].map((option) => option.textContent)).toEqual([
            'ASAP', 'ALAP', 'SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO',
        ]);

        await act(async () => {
            ruleSelect.value = 'SNET';
            ruleSelect.dispatchEvent(new Event('change', { bubbles: true }));
            await Promise.resolve();
        });

        const constraint = requiredElement(container, 'input[aria-invalid="true"]');
        if (!(constraint instanceof HTMLInputElement)) {
            throw new Error('Expected constraint date input');
        }
        expect(constraint.placeholder).toBe('YYYY');
        expect(document.activeElement).toBe(constraint);
        expect(container.textContent).toContain(
            'Enter a constraint date for the selected scheduling rule.',
        );

        const helpButton = requiredElement(
            container,
            'button[title="Show scheduling rule explanations"]',
        );
        if (!(helpButton instanceof HTMLButtonElement)) {
            throw new Error('Expected scheduling help button');
        }
        act(() => {
            helpButton.click();
        });
        const helpRegion = requiredElement(container, '[role="region"]');
        expect(helpRegion.textContent).toContain('Selected rule');
        expect(helpRegion.textContent).toContain('SNET');
        expect(helpRegion.querySelectorAll('dt')).toHaveLength(1);

        const showAll = [...helpRegion.querySelectorAll('button')]
            .find((button) => button.textContent === 'Show all rules');
        if (!showAll) throw new Error('Missing show-all-rules button');
        act(() => {
            showAll.click();
        });
        expect(helpRegion.querySelectorAll('dt')).toHaveLength(8);
        expect(helpRegion.textContent).toContain('Show only the selected rule');
        expect(container.querySelector(
            'button[title="Sets the desired latest finish. Exceeding it raises a warning but does not move schedule dates."]',
        )).not.toBeNull();
    });

    it('identifies the predecessor that drives an automatic start', () => {
        const signedPeriod: ReturnType<typeof parsePeriod> = {
            ...initialPeriod,
            start: '-2400-01-01T09:00',
            end: '-2398-01-01T09:00',
            startMode: 'auto',
        };
        const { container } = mount(
            <PlanningPeriodFixture initialValue={signedPeriod} />,
        );
        const summary = requiredElement(
            container,
            'section[aria-label="Calculation summary"]',
        );
        expect(summary.textContent).toContain('Start: -2400');
        expect(summary.textContent).toContain('Finish: -2398');
        expect(summary.textContent).toContain(
            'Automatic start from: Previous task',
        );
    });
});
