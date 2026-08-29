export type RecurrenceEndType = 'count' | 'never' | 'until';


export interface RecurrenceState {
    readonly endCount: string;
    readonly endType: RecurrenceEndType;
    readonly recurrence: string;
    readonly selectedDays: readonly string[];
    readonly untilDate: string;
}


const initialRecurrenceState: RecurrenceState = {
    endCount: '10',
    endType: 'never',
    recurrence: '',
    selectedDays: [],
    untilDate: '',
};


export function parseRrule(rrule?: string | null): RecurrenceState {
    if (!rrule) return initialRecurrenceState;
    const cleanRrule = rrule.startsWith('RRULE:') ? rrule.slice(6) : rrule;
    const rules = new Map<string, string>();
    for (const part of cleanRrule.split(';')) {
        const separator = part.indexOf('=');
        if (separator < 1) continue;
        rules.set(part.slice(0, separator).toUpperCase(), part.slice(separator + 1));
    }

    const count = rules.get('COUNT');
    const until = rules.get('UNTIL');
    return {
        endCount: count || initialRecurrenceState.endCount,
        endType: count ? 'count' : until ? 'until' : 'never',
        recurrence: rules.get('FREQ') || '',
        selectedDays: rules.get('BYDAY')?.split(',').filter(Boolean) || [],
        untilDate: until && until.length >= 8
            ? `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`
            : '',
    };
}


export function buildRrule(state: RecurrenceState): string | null {
    if (!state.recurrence) return null;
    const parts = [`FREQ=${state.recurrence}`];
    if (state.recurrence === 'WEEKLY' && state.selectedDays.length > 0) {
        parts.push(`BYDAY=${state.selectedDays.join(',')}`);
    }
    if (state.endType === 'count') {
        parts.push(`COUNT=${state.endCount}`);
    } else if (state.endType === 'until' && state.untilDate) {
        parts.push(`UNTIL=${state.untilDate.replace(/-/gu, '')}T235959Z`);
    }
    return parts.join(';');
}


export function toggleRecurrenceDay(
    selectedDays: readonly string[],
    day: string,
): string[] {
    return selectedDays.includes(day)
        ? selectedDays.filter((selectedDay) => selectedDay !== day)
        : [...selectedDays, day];
}
