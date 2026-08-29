import { GnosiApiError } from './errors';
import { downloadFetch } from './specialized-transports';


export interface LiteratureReviewDownload {
  readonly blob: Blob;
  readonly contentDisposition: string;
}


async function errorPayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.clone().json().catch(() => undefined);
  }
  return response.clone().text().catch(() => undefined);
}


export async function downloadLiteratureReview(
  reviewId: string,
  exportFormat: string,
  signal?: AbortSignal,
): Promise<LiteratureReviewDownload> {
  const response = await downloadFetch(
    `/api/vault/literature/reviews/${encodeURIComponent(reviewId)}/exports/${encodeURIComponent(exportFormat)}`,
    { method: 'GET', signal },
  );
  if (!response.ok) throw new GnosiApiError(response, await errorPayload(response));
  return {
    blob: await response.blob(),
    contentDisposition: response.headers.get('content-disposition') ?? '',
  };
}
