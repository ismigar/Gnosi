export const parseMarkdownHeading = (line: string | undefined) => {
    const match = (line || '').match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match?.[1] || !match[2]) return null;

    const level = match[1].length;
    const title = match[2]
        .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
        .replace(/[*_`~]/g, '')
        .trim();

    if (!title) return null;
    return { level, title };
};

export const markdownToPlainText = (markdown: string | null | undefined) => {
    return (markdown || '')
        .replace(/!\[\[[^\]]+\]\]/g, '')
        .replace(/\[\[[^\]]+\]\]/g, '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/[#>*_`~-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

export const extractSectionPreview = (markdown: string | null | undefined, sectionName: string) => {
    const cleanSectionName = sectionName.trim().toLowerCase();
    if (!cleanSectionName) return '';

    if (cleanSectionName.startsWith('^')) {
        const blockId = cleanSectionName.substring(1).trim();
        if (!blockId) return '';
        const source = (markdown || '').replace(/```[\s\S]*?```/g, '');
        const lines = source.split('\n');
        for (const line of lines) {
            const markerMatch = (line || '').match(/(?:^|\s)\^([a-zA-Z0-9_-]+)\s*$/);
            if (!markerMatch?.[1]) continue;
            if (markerMatch[1].toLowerCase() !== blockId) continue;
            const cleanLine = (line || '').replace(/\s*\^[a-zA-Z0-9_-]+\s*$/, '').trim();
            return markdownToPlainText(cleanLine);
        }
        return '';
    }

    const source = (markdown || '').replace(/```[\s\S]*?```/g, '');
    const lines = source.split('\n');

    let startIndex = -1;
    let startLevel = 0;

    for (let i = 0; i < lines.length; i += 1) {
        const heading = parseMarkdownHeading(lines[i]);
        if (!heading) continue;

        if (heading.title.toLowerCase() === cleanSectionName) {
            startIndex = i + 1;
            startLevel = heading.level;
            break;
        }
    }

    if (startIndex < 0) return '';

    const sectionLines = [];
    for (let i = startIndex; i < lines.length; i += 1) {
        const heading = parseMarkdownHeading(lines[i]);
        if (heading && heading.level <= startLevel) {
            break;
        }
        sectionLines.push(lines[i]);
    }

    return markdownToPlainText(sectionLines.join('\n'));
};
