import type { TFunction } from 'i18next';
import { GnosiApiError } from '../../shared/api/errors';
export function errorMessage(error: unknown, t: TFunction): string {
  const payload = error instanceof GnosiApiError ? error.payload : error;
  if (payload && typeof payload === 'object' && 'detail' in payload) {
    const detail = payload.detail;
    if (detail && typeof detail === 'object' && 'issues' in detail && Array.isArray(detail.issues)) {
      const codes = detail.issues.flatMap((issue: unknown) => issue && typeof issue === 'object' && 'code' in issue && typeof issue.code === 'string' ? [issue.code] : []);
      if (codes.length) return [...new Set(codes)].map(code => t(`genograms.issues_codes.${code}`, { defaultValue: t('genograms.error') })).join(' ');
    }
    if (detail && typeof detail === 'object' && 'error' in detail && detail.error === 'etag_mismatch') return t('genograms.conflict');
    if (detail && typeof detail === 'object' && 'code' in detail) return t(`genograms.errors.${String(detail.code)}`, { defaultValue: t('genograms.error') });
  }
  return t('genograms.error');
}
