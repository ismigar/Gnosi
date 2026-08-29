export async function writeClipboardText(value: string): Promise<void> {
    const runtimeNavigator: {
        readonly clipboard?: Pick<Clipboard, 'writeText'>;
    } = navigator;
    if (!runtimeNavigator.clipboard) {
        throw new Error('Clipboard API unavailable');
    }
    await runtimeNavigator.clipboard.writeText(value);
}
