import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { VaultDateProperty } from './VaultDateProperty';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key, fallback) => fallback || key,
    }),
}));

vi.mock('../../hooks/useLocaleSettings', () => ({
    useLocaleSettings: () => ({ dateLocale: 'en-US' }),
}));

const mountedRoots = [];

const initialPeriod = {
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
];

function PlanningPeriodFixture() {
    const [period, setPeriod] = useState(initialPeriod);

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

beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
    while (mountedRoots.length) {
        const { root, container } = mountedRoots.pop();
        await act(async () => root.unmount());
        container.remove();
    }
});

describe('VaultDateProperty planning constraints', () => {
    it('keeps codes in the selector and guides date-based rules contextually', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        mountedRoots.push({ root, container });

        await act(async () => {
            root.render(<PlanningPeriodFixture />);
        });

        const ruleSelect = [...container.querySelectorAll('select')]
            .find((select) => select.querySelector('option[value="SNET"]'));
        expect(ruleSelect).toBeTruthy();
        expect([...ruleSelect.options].map((option) => option.textContent)).toEqual([
            'ASAP',
            'ALAP',
            'SNET',
            'SNLT',
            'FNET',
            'FNLT',
            'MSO',
            'MFO',
        ]);

        await act(async () => {
            ruleSelect.value = 'SNET';
            ruleSelect.dispatchEvent(new Event('change', { bubbles: true }));
        });

        const constraintInput = container.querySelector('input[aria-invalid="true"]');
        expect(constraintInput).toBeTruthy();
        expect(constraintInput.placeholder).toBe('YYYY');
        expect(document.activeElement).toBe(constraintInput);
        expect(container.textContent).toContain(
            'Enter a constraint date for the selected scheduling rule.',
        );

        const ruleHelpButton = container.querySelector(
            'button[title="Show scheduling rule explanations"]',
        );
        await act(async () => {
            ruleHelpButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        const helpRegion = container.querySelector('[role="region"]');
        expect(helpRegion.textContent).toContain('Selected rule');
        expect(helpRegion.textContent).toContain('SNET');
        expect(helpRegion.querySelectorAll('dt')).toHaveLength(1);

        const showAllButton = [...helpRegion.querySelectorAll('button')]
            .find((button) => button.textContent === 'Show all rules');
        await act(async () => {
            showAllButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(helpRegion.querySelectorAll('dt')).toHaveLength(8);
        expect(helpRegion.textContent).toContain('Show only the selected rule');

        expect(container.querySelector(
            'button[title="Sets the desired latest finish. Exceeding it raises a warning but does not move schedule dates."]',
        )).toBeTruthy();
        expect(container.querySelector(
            'button[title="It is required by the selected rule and changes the automatic schedule; a deadline only raises a warning."]',
        )).toBeTruthy();
    });
});
