export const chatScrollDeltaForComposerKey = ({
    key,
    value,
    altKey = false,
    ctrlKey = false,
    metaKey = false,
    shiftKey = false,
}) => {
    if (value || altKey || ctrlKey || metaKey || shiftKey) return 0;
    if (key === 'ArrowUp') return -120;
    if (key === 'ArrowDown') return 120;
    return 0;
};
