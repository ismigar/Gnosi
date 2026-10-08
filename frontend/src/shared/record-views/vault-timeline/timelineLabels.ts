export function timelineTitle(value: unknown, fallback: string): string {
    return typeof value === 'string' && value ? value
        : typeof value === 'number' || typeof value === 'bigint' ? String(value) : fallback;
}


export function timelineErrorKey(error: unknown): string {
    return error instanceof Error && ['timeline.partial_save', 'timeline.dependency_cycle'].includes(error.message)
        ? error.message : 'timeline.save_error';
}
