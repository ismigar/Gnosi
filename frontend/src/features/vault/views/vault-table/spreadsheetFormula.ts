/** Small, bounded spreadsheet interpreter. Never executes JavaScript. */
export type SpreadsheetValue = string | number | boolean;
type Value = SpreadsheetValue | Value[];
export interface FormulaContext {
  cell: (row: number, column: number) => unknown;
  field: (name: string) => unknown;
}
export const isCellFormula = (value: unknown): value is string => typeof value === 'string' && value.startsWith('=');
export const supportsCellFormula = (type: string): boolean => type === 'text' || type === 'number' || type === '';
export function columnLabel(index: number): string {
  let label = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + (n - 1) % 26) + label;
  return label;
}
function reference(token: string): { row: number; column: number } | null {
  const match = /^\$?([A-Z]+)\$?([1-9]\d*)$/i.exec(token);
  if (!match) return null;
  let column = 0;
  for (const letter of (match[1] ?? '').toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64;
  return { row: Number(match[2]) - 1, column: column - 1 };
}
/** Relative references move on copy; quoted strings and named fields stay literal. */
export function translateFormula(formula: string, rows: number, columns: number): string {
  return formula.replace(/"(?:[^"]|"")*"|\[[^\]]+\]|\{[^}]+\}|\$?[A-Z]+\$?[1-9]\d*/gi, (token, offset: number) => {
    if (/[\w.]/.test(formula[offset - 1] ?? '') || /[\w(]/.test(formula[offset + token.length] ?? '')) return token;
    const ref = reference(token);
    if (!ref) return token;
    const row = ref.row + (/\$\d/.test(token) ? 0 : rows);
    const column = ref.column + (token.startsWith('$') ? 0 : columns);
    return row < 0 || column < 0 ? '#REF!' : `${token.startsWith('$') ? '$' : ''}${columnLabel(column)}${/\$\d/.test(token) ? '$' : ''}${String(row + 1)}`;
  });
}
function fail(code: string): never { throw new Error(code); }
function scalar(value: unknown): SpreadsheetValue {
  if (typeof value === 'string' && /^#(?:REF!|VALUE!|DIV\/0!|NAME\?|ERROR!|CYCLE!)$/.test(value)) fail(value);
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return fail('#VALUE!');
}
function number(value: Value): number {
  if (Array.isArray(value)) return fail('#VALUE!');
  const result = Number(value);
  return Number.isFinite(result) ? result : fail('#VALUE!');
}
function flatten(values: Value[]): SpreadsheetValue[] {
  return values.flatMap(value => Array.isArray(value) ? flatten(value) : [value]);
}
export function evaluateSpreadsheetFormula(formula: string, context: FormulaContext): SpreadsheetValue {
  try {
    if (formula.length > 4096) return '#ERROR!';
    const source = formula.slice(1);
    const tokens: string[] = [];
    const pattern = /\s*("(?:[^"]|"")*"|\[[^\]]+\]|\{[^}]+\}|#(?:REF!|VALUE!|DIV\/0!|NAME\?|ERROR!|CYCLE!)|\$?[A-Za-z_][A-Za-z_0-9.$]*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|<>|<=|>=|[+\-*/^&%=<>():,;])/gy;
    let offset = 0;
    while (offset < source.trimEnd().length) {
      pattern.lastIndex = offset;
      const match = pattern.exec(source);
      if (!match?.[1]) return '#ERROR!';
      tokens.push(match[1]); offset = pattern.lastIndex;
      if (tokens.length > 512) return '#ERROR!';
    }
    // Parse into closures so IF evaluates only its selected branch.
    type Expression = () => Value;
    let position = 0, depth = 0;
    const peek = () => tokens[position] ?? '';
    const take = () => tokens[position++] ?? '';
    const expect = (token: string) => { if (take() !== token) fail('#ERROR!'); };
    const precedence: Record<string, number> = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 };
    const expression = (minimum = 0): Expression => {
      if (++depth > 64) fail('#ERROR!');
      let left = primary();
      while (peek() && (precedence[peek()] ?? -1) >= minimum) {
        const operator = take(), priority = precedence[operator] ?? 0;
        const right = expression(priority + (operator === '^' ? 0 : 1)), previous = left;
        left = () => {
          const a = previous(), b = right();
          if (Array.isArray(a) || Array.isArray(b)) return fail('#VALUE!');
          switch (operator) {
            case '+': return number(a) + number(b);
            case '-': return number(a) - number(b);
            case '*': return number(a) * number(b);
            case '/': return number(b) === 0 ? fail('#DIV/0!') : number(a) / number(b);
            case '^': return number(a) ** number(b);
            case '&': return String(a) + String(b);
            case '=': return a === b;
            case '<>': return a !== b;
            case '<': return number(a) < number(b);
            case '>': return number(a) > number(b);
            case '<=': return number(a) <= number(b);
            case '>=': return number(a) >= number(b);
            default: return fail('#ERROR!');
          }
        };
      }
      depth--; return left;
    };
    const primary = (): Expression => {
      const token = take();
      let value: Expression;
      if (token === '+' || token === '-') {
        const operand = expression(5); value = () => (token === '-' ? -1 : 1) * number(operand());
      } else if (token === '(') { value = expression(); expect(')'); }
      else if (token.startsWith('"')) value = () => token.slice(1, -1).replace(/""/g, '"');
      else if (token.startsWith('#')) value = () => fail(token);
      else if (token.startsWith('[') || token.startsWith('{')) value = () => scalar(context.field(token.slice(1, -1)));
      else if (/^(?:\d|\.\d)/.test(token)) value = () => Number(token);
      else if (/^(TRUE|FALSE)$/i.test(token)) value = () => token.toUpperCase() === 'TRUE';
      else if (peek() === '(') {
        take(); const args: Expression[] = [];
        if (peek() !== ')') {
          args.push(expression());
          while (peek() === ',' || peek() === ';') { take(); args.push(expression()); }
        }
        expect(')');
        value = () => {
          const name = token.toUpperCase();
          if (name === 'IF' || name === 'SI') {
            if (args.length !== 3) return fail('#VALUE!');
            const condition = args[0]?.();
            if (Array.isArray(condition)) return fail('#VALUE!');
            return (condition ? args[1]?.() : args[2]?.()) ?? '';
          }
          const evaluated = args.map(arg => arg());
          const flat = flatten(evaluated);
          const numeric = flat.filter(v => v !== '' && Number.isFinite(Number(v))).map(Number);
          switch (name) {
            case 'SUM': case 'SUMA': case 'SOMME': return numeric.reduce((a, b) => a + b, 0);
            case 'AVERAGE': case 'MITJANA': case 'PROMEDIO': case 'MOYENNE':
              return numeric.length ? numeric.reduce((a, b) => a + b, 0) / numeric.length : fail('#DIV/0!');
            case 'MIN': return numeric.length ? Math.min(...numeric) : 0;
            case 'MAX': return numeric.length ? Math.max(...numeric) : 0;
            case 'COUNT': return numeric.length;
            case 'ABS': return args.length === 1 ? Math.abs(number(evaluated[0] ?? '')) : fail('#VALUE!');
            case 'ROUND': {
              if (args.length < 1 || args.length > 2) return fail('#VALUE!');
              const scale = 10 ** number(evaluated[1] ?? 0); return Math.round(number(evaluated[0] ?? '') * scale) / scale;
            }
            default: return fail('#NAME?');
          }
        };
      } else {
        const ref = reference(token);
        if (!ref) return fail('#NAME?');
        if (peek() === ':') {
          take(); const end = reference(take());
          if (!end) return fail('#REF!');
          const r0 = Math.min(ref.row, end.row), r1 = Math.max(ref.row, end.row);
          const c0 = Math.min(ref.column, end.column), c1 = Math.max(ref.column, end.column);
          if ((r1 - r0 + 1) * (c1 - c0 + 1) > 10000) return fail('#REF!');
          value = () => {
            const cells: Value[] = [];
            for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells.push(scalar(context.cell(r, c)));
            return cells;
          };
        } else value = () => scalar(context.cell(ref.row, ref.column));
      }
      if (peek() === '%') { take(); const operand = value; value = () => number(operand()) / 100; }
      return value;
    };
    const evaluate = expression();
    if (position !== tokens.length) return '#ERROR!';
    const value = evaluate();
    if (Array.isArray(value)) return '#ERROR!';
    return typeof value === 'number' && !Number.isFinite(value) ? '#VALUE!' : value;
  } catch (error) { return error instanceof Error && error.message.startsWith('#') ? error.message : '#ERROR!'; }
}
