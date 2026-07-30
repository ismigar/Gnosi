export const mergeConfirmationRecords = (messages, confirmations, summaryFor) => {
    const byId = new Map(
        (confirmations || []).map(item => [item.confirmation_id, item]),
    );
    const existingIds = new Set();
    const updated = (messages || []).map(message => {
        const confirmationId = message?.confirmation?.confirmation_id;
        if (!confirmationId) return message;
        existingIds.add(confirmationId);
        const current = byId.get(confirmationId);
        return current
            ? {
                ...message,
                content: summaryFor(current),
                confirmation: { ...message.confirmation, ...current },
            }
            : message;
    });
    for (const confirmation of confirmations || []) {
        if (existingIds.has(confirmation.confirmation_id)) continue;
        updated.push({
            role: 'assistant',
            content: summaryFor(confirmation),
            confirmation,
        });
    }
    return updated;
};

export const confirmationForStorage = confirmation => {
    if (!confirmation) return undefined;
    return {
        ...confirmation,
        details: {},
        summary_key: 'chat.confirmations.summary',
    };
};
