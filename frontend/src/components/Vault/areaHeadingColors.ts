type HeadingTextValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined;

type AreaHeadingColorKey =
  | 'blue'
  | 'pink'
  | 'brown'
  | 'green'
  | 'red'
  | 'yellow'
  | 'gray'
  | 'purple'
  | 'orange';

interface AreaHeadingRule {
  key: AreaHeadingColorKey;
  prefixes: readonly string[];
}

/** Normalizes an area heading for accent-insensitive prefix matching. */
export function normalizeHeadingText(raw?: HeadingTextValue): string {
  return String(raw || '')
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const RULES: readonly AreaHeadingRule[] = [
  { key: 'blue', prefixes: ['formacio', 'formacion'] },
  { key: 'pink', prefixes: ['experiencia prof', 'experiencia profe'] },
  { key: 'brown', prefixes: ['competencies', 'competencias'] },
  {
    key: 'green',
    prefixes: ['desenvolupades', 'desenvolupada', 'desarrolladas'],
  },
  { key: 'red', prefixes: ['a desenvolupar', 'a desarrollar'] },
  { key: 'yellow', prefixes: ['com contribueixen'] },
  { key: 'gray', prefixes: ['recursos'] },
  { key: 'purple', prefixes: ['projectes', 'proyectos'] },
  {
    key: 'orange',
    prefixes: ['notes i extractes', 'notes i estractes'],
  },
];

/** Returns the fixed area-heading color, or null for unknown sections. */
export function areaHeadingColorKey(
  rawText?: HeadingTextValue,
): AreaHeadingColorKey | null {
  const normalized = normalizeHeadingText(rawText);
  if (!normalized) return null;
  for (const rule of RULES) {
    if (rule.prefixes.some((prefix) => normalized.startsWith(prefix))) {
      return rule.key;
    }
  }
  return null;
}

export default areaHeadingColorKey;
