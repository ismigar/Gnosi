type FormulaValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined;

type FormulaMetadata = Record<string, FormulaValue>;

interface FormulaEvaluator {
  (
    selectBranch: (
      condition: unknown,
      whenTrue: unknown,
      whenFalse: unknown,
    ) => unknown,
  ): unknown;
}

function isFormulaEvaluator(value: unknown): value is FormulaEvaluator {
  return typeof value === 'function';
}

/** Evaluates a simple formula expression over Vault metadata. */
export function evaluateFormula(
  formula?: unknown,
  metadata: FormulaMetadata = {},
  title: FormulaValue = '',
): unknown {
  if (!formula || typeof formula !== 'string') return null;

  try {
    let expression = formula.trim();

    expression = expression.replace(/\bif\s*\(/gi, '__IF(');

    const now = new Date();
    const pad = (value: number): string =>
      String(value).padStart(2, '0');
    const today = `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    expression = expression.replace(/\bnow\(\)/gi, `"${today}"`);
    expression = expression.replace(/\btoday\(\)/gi, `"${today}"`);

    expression = expression.replace(
      /\bprop\('([^']+)'\)/g,
      (_match, name: string) => {
        const value =
          name === 'title' || name === 'Títol'
            ? title
            : (metadata[name] ?? '');
        return typeof value === 'string'
          ? `"${value.replace(/"/g, '\\"')}"`
          : String(value ?? '');
      },
    );

    expression = expression.replace(
      /\{([^}]+)\}/g,
      (_match, name: string) => {
        const value =
          name === 'title' || name === 'Títol'
            ? title
            : (metadata[name] ?? '');
        if (typeof value === 'number') return String(value);
        if (typeof value === 'boolean') return value ? '1' : '0';
        return `"${String(value ?? '').replace(/"/g, '\\"')}"`;
      },
    );

    expression = expression.replace(
      /\blen\("([^"]*)"\)/g,
      (_match, value: string) => String(value.length),
    );

    const selectFormulaBranch = (
      condition: unknown,
      whenTrue: unknown,
      whenFalse: unknown,
    ): unknown => {
      const falsy =
        condition == null ||
        condition === false ||
        condition === 0 ||
        condition === '' ||
        condition === 'false' ||
        condition === '0';
      return falsy ? whenFalse : whenTrue;
    };
    const functionConstructor: unknown = Reflect.get(
      globalThis,
      'Function',
    );
    if (typeof functionConstructor !== 'function') return null;
    const evaluator: unknown = Reflect.construct(functionConstructor, [
      '__IF',
      '"use strict"; return (' + expression + ')',
    ]);
    if (!isFormulaEvaluator(evaluator)) return null;
    const result: unknown = evaluator(selectFormulaBranch);
    if (typeof result === 'number' && !Number.isFinite(result)) return null;
    return result ?? null;
  } catch {
    return null;
  }
}
