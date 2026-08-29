type DefaultFormulaValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined;

type DefaultFormulaMetadata = Record<string, DefaultFormulaValue>;

interface DefaultFormulaContext {
  currentTableId?: string;
  metadata?: DefaultFormulaMetadata;
  notes?: readonly unknown[];
  title?: string;
}

interface ApplyDefaultFormulaInput {
  currentTableId?: string;
  metadata?: DefaultFormulaMetadata;
  notes?: readonly unknown[];
  schema?: Record<string, unknown>;
  title?: string;
}

const localTodayString = (): string => {
  const date = new Date();
  const pad = (value: number): string =>
    String(value).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function evaluateDefaultFormula(
  formula: unknown,
  context: DefaultFormulaContext = {},
): string | null {
  if (!formula || typeof formula !== 'string') return null;
  const expression = formula.trim();

  if (/^now\(\)$/i.test(expression)) {
    return localTodayString();
  }

  if (/^today\(\)$/i.test(expression)) {
    return localTodayString();
  }

  const propertyReference = expression.match(/^\{(.+)\}$/);
  if (propertyReference) {
    const fieldName = (propertyReference[1] ?? '').trim();
    if (
      context.metadata &&
      context.metadata[fieldName] !== undefined
    ) {
      return String(context.metadata[fieldName]);
    }
    if (
      fieldName.toLowerCase() === 'title' ||
      fieldName.toLowerCase() === 'títol'
    ) {
      return context.title || '';
    }
    return null;
  }

  return expression;
}

export function applyDefaultFormulasToMetadata({
  schema = {},
  metadata = {},
  title = '',
  notes = [],
  currentTableId = '',
}: ApplyDefaultFormulaInput): DefaultFormulaMetadata {
  const result: DefaultFormulaMetadata = { ...metadata };

  Object.keys(schema).forEach((key) => {
    if (key.endsWith('_config')) return;

    const configValue = schema[`${key}_config`];
    const config = isUnknownRecord(configValue) ? configValue : {};
    const defaultFormula = config.defaultFormula;

    if (
      defaultFormula &&
      (result[key] === undefined ||
        result[key] === null ||
        result[key] === '')
    ) {
      const evaluated = evaluateDefaultFormula(defaultFormula, {
        metadata: result,
        title,
        notes,
        currentTableId,
      });
      if (evaluated !== null) {
        result[key] = evaluated;
      }
    }
  });

  return result;
}
