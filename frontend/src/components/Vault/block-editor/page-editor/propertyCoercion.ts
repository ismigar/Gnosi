import { coerceValueForField, type FieldCoercionContext, type FieldCoercionResult } from '../../cellGridUtils';
import type { PageOption } from './types';
import { isRecord } from './valueBoundaries';

export interface PageCoercionContext extends Omit<FieldCoercionContext, 'options'> {
  options?: readonly PageOption[];
}

/**
 * The legacy page editor forwards rich catalogs unchanged, while the shared
 * coercer's declaration only admits strings. Keep that runtime contract (even
 * its existing unsupported-rich-option failure) without a type assertion or a
 * second coercion implementation. Validate the result at this narrow bridge.
 */
export function coercePageProperty(raw: unknown, type: string, context: PageCoercionContext): FieldCoercionResult {
  const result: unknown = Reflect.apply(coerceValueForField, undefined, [raw, type, context]);
  if (!isRecord(result)) throw new TypeError('Invalid property coercion result');
  if (result.skip === true) return { skip: true };
  if ('value' in result && (result.skip === undefined || result.skip === false)) return { value: result.value };
  throw new TypeError('Invalid property coercion result');
}
