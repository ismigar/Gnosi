/** Only the last table interacted with may consume global editing shortcuts. */
export const keyboardOwnership: { owner: string | null; sequence: number; } = { owner: null, sequence: 0 };
