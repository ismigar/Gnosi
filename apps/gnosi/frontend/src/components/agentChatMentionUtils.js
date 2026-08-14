export const visibleMentionToken = label => `@${label}`;

export const selectedMentionsInText = (text, selectedMentions) => (
    (selectedMentions || [])
        .filter((mention) => mention?.token && text.includes(mention.token))
        .map(({ type, id, label }) => ({ type, id, label }))
);
