export function parseVaultResourceValue(rawValue: unknown) {
    if (rawValue === undefined || rawValue === null) return null;
    const text = Reflect.apply(String, undefined, [rawValue]).trim();
    if (!text) return null;

    const markdownMatch = text.match(/\(([^)]+)\)/);
    const candidate = markdownMatch ? (markdownMatch[1] ?? '').trim() : text;

    if (candidate.startsWith('zotero://')) {
      return { zotero_uri: candidate, file_path: null, attachments: null };
    }

    if (candidate.startsWith('file://')) {
      return { zotero_uri: null, file_path: candidate, attachments: null };
    }

    const embeddedZotero = candidate.match(/zotero:\/\/\S+/i);
    if (embeddedZotero?.[0]) {
      return { zotero_uri: embeddedZotero[0], file_path: null, attachments: null };
    }

    return { zotero_uri: null, file_path: candidate, attachments: null };
}
