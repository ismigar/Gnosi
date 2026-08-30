type FormulaValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined;

type FormulaMetadata = Readonly<Record<string, unknown>>;

type FormulaResult = Exclude<FormulaValue, undefined> | symbol | object;

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

// Imported arrays and objects retain JavaScript's property text coercion.
function formulaPropertyText(value: unknown): string {
  return String(value);
}

/** Evaluates a simple formula expression over Vault metadata. */
export function evaluateFormula(
  formula?: unknown,
  metadata: FormulaMetadata = {},
  title: FormulaValue = '',
): FormulaResult {
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
          : formulaPropertyText(value ?? '');
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
        return `"${formulaPropertyText(value ?? '').replace(/"/g, '\\"')}"`;
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
    if (typeof result === 'number') return Number.isFinite(result) ? result : null;
    if (
      typeof result === 'string' ||
      typeof result === 'boolean' ||
      typeof result === 'bigint' ||
      typeof result === 'symbol' ||
      typeof result === 'object' ||
      typeof result === 'function'
    ) return result;
    return null;
  } catch {
    return null;
  }
}
