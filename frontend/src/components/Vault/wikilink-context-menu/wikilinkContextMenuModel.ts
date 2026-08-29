export interface ContextMenuPosition {
    readonly x: number;
    readonly y: number;
}


export interface ContextMenuSize {
    readonly height: number;
    readonly width: number;
}


export function nextEnabledMenuIndex(
    enabledIndices: readonly number[],
    currentIndex: number,
    delta: -1 | 1,
): number {
    if (enabledIndices.length === 0) return -1;
    if (currentIndex < 0) {
        return delta > 0
            ? enabledIndices[0] ?? -1
            : enabledIndices.at(-1) ?? -1;
    }
    const currentPosition = enabledIndices.indexOf(currentIndex);
    const normalizedPosition = currentPosition < 0 ? 0 : currentPosition;
    const nextPosition = (
        normalizedPosition + delta + enabledIndices.length
    ) % enabledIndices.length;
    return enabledIndices[nextPosition] ?? -1;
}


export function adjustedContextMenuPosition(
    position: ContextMenuPosition,
    menu: ContextMenuSize,
    viewport: ContextMenuSize,
    padding = 8,
): ContextMenuPosition {
    const x = position.x + menu.width > viewport.width - padding
        ? Math.max(padding, viewport.width - menu.width - padding)
        : position.x;
    const y = position.y + menu.height > viewport.height - padding
        ? Math.max(padding, viewport.height - menu.height - padding)
        : position.y;
    return { x, y };
}
