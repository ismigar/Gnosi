const ARROW_STEP = 56;

export function getPanelScrollTarget(key, scrollTop, clientHeight, scrollHeight) {
    const maximum = Math.max(0, scrollHeight - clientHeight);
    let target;

    if (key === 'ArrowDown') target = scrollTop + ARROW_STEP;
    else if (key === 'ArrowUp') target = scrollTop - ARROW_STEP;
    else if (key === 'PageDown') target = scrollTop + clientHeight * 0.85;
    else if (key === 'PageUp') target = scrollTop - clientHeight * 0.85;
    else if (key === 'Home') target = 0;
    else if (key === 'End') target = maximum;
    else return null;

    return Math.min(maximum, Math.max(0, target));
}
