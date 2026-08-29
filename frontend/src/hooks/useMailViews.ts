import { useCallback, useEffect, useState } from 'react';

import { GnosiApiError } from '../shared/api/errors';
import {
  createMailView,
  deleteMailView,
  fetchMailViews,
  updateMailView,
  type MailView,
  type MailViewCreate,
  type MailViewUpdate,
} from '../shared/api/mail';


function legacyHttpError(error: unknown, message: string): Error {
  if (error instanceof GnosiApiError) return new Error(message, { cause: error });
  return error instanceof Error ? error : new Error(message, { cause: error });
}


function rethrowLegacyHttpError(error: unknown, message: string): never {
  throw legacyHttpError(error, message);
}


export function useMailViews() {
  const [views, setViews] = useState<MailView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchViews = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setViews(await fetchMailViews());
    } catch (caughtError: unknown) {
      setError(legacyHttpError(caughtError, 'Error loading views').message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchViews();
  }, [fetchViews]);

  const createView = useCallback(async (data: MailViewCreate): Promise<MailView> => {
    let created: MailView;
    try {
      created = await createMailView(data);
    } catch (caughtError: unknown) {
      rethrowLegacyHttpError(caughtError, 'Error creant vista');
    }
    setViews((previous) => [...previous, created]);
    return created;
  }, []);

  const updateView = useCallback(async (
    id: string,
    data: MailViewUpdate,
  ): Promise<MailView> => {
    let updated: MailView;
    try {
      updated = await updateMailView(id, data);
    } catch (caughtError: unknown) {
      rethrowLegacyHttpError(caughtError, 'Error actualitzant vista');
    }
    setViews((previous) => previous.map((view) => (
      view.id === id ? updated : view
    )));
    return updated;
  }, []);

  const deleteView = useCallback(async (id: string): Promise<void> => {
    try {
      await deleteMailView(id);
    } catch (caughtError: unknown) {
      rethrowLegacyHttpError(caughtError, 'Error eliminant vista');
    }
    setViews((previous) => previous.filter((view) => view.id !== id));
  }, []);

  return {
    views,
    loading,
    error,
    fetchViews,
    createView,
    updateView,
    deleteView,
  };
}
