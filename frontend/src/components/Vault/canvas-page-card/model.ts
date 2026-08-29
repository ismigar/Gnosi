export function pageCardPreview(content: string): string {
    return content.replace(/^---[\s\S]*?---\s*/, '').slice(0, 320);
}
