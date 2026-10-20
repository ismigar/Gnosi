/** Prepare prose for speech without reading Markdown syntax or destination URLs. */
export function speechText(markdown: string): string {
  const text = markdown
    .replace(/```[^\n]*\n[\s\S]*?(?:```|$)/g, '\n')
    .replace(/~~~[^\n]*\n[\s\S]*?(?:~~~|$)/g, '\n')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/^\s*\|?\s*:?-{3,}[^\n]*$/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s*\|\s*/g, ', ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
  if (text.length <= 12000) return text;
  const bounded = text.slice(0, 12000);
  const sentence = Math.max(bounded.lastIndexOf('. '), bounded.lastIndexOf('! '), bounded.lastIndexOf('? '), bounded.lastIndexOf('\n'));
  return bounded.slice(0, sentence > 6000 ? sentence + 1 : bounded.lastIndexOf(' ')).trim();
}

/** Bound each utterance at a sentence or word boundary for responsive cancellation. */
export function speechChunks(text: string, limit = 2800): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > limit) {
    const part = remaining.slice(0, limit);
    const boundary = Math.max(part.lastIndexOf('. '), part.lastIndexOf('? '), part.lastIndexOf('! '), part.lastIndexOf('\n'));
    const space = part.lastIndexOf(' ');
    const end = boundary > limit / 2 ? boundary + 1 : space > 0 ? space : limit;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
