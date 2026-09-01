const MANAGED_START_RE = /^<!-- gnosi:llm-wiki:start [^\r\n]* -->$/;
const MANAGED_END_RE = /^<!-- gnosi:llm-wiki:end [^\r\n]* -->$/;
const FENCE_RE = /^\s*(```|~~~)/;

/** Separates managed markers from their Markdown content. */
export const normalizeManagedBlockSpacing = <Value>(
  markdown: Value,
): Value | string => {
  if (
    typeof markdown !== 'string' ||
    !markdown.includes('<!-- gnosi:llm-wiki:')
  ) {
    return markdown;
  }

  const lines = markdown.split('\n');
  const normalized: string[] = [];
  let inFence = false;

  lines.forEach((line, index) => {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      normalized.push(line);
      return;
    }

    if (
      !inFence &&
      MANAGED_END_RE.test(line) &&
      normalized.at(-1)?.trim()
    ) {
      normalized.push('');
    }

    normalized.push(line);

    if (
      !inFence &&
      MANAGED_START_RE.test(line) &&
      index + 1 < lines.length &&
      lines.at(index + 1)?.trim()
    ) {
      normalized.push('');
    }
  });

  return normalized.join('\n');
};

/** Removes managed boundary markers while preserving their Markdown. */
export const stripManagedBlockMarkers = <Value>(
  markdown: Value,
): Value | string => {
  if (
    typeof markdown !== 'string' ||
    !markdown.includes('<!-- gnosi:llm-wiki:')
  ) {
    return markdown;
  }

  const visibleLines: string[] = [];
  let inFence = false;

  markdown.split('\n').forEach((line) => {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      visibleLines.push(line);
      return;
    }
    if (
      !inFence &&
      (MANAGED_START_RE.test(line) || MANAGED_END_RE.test(line))
    ) {
      return;
    }
    visibleLines.push(line);
  });

  return visibleLines.join('\n');
};
