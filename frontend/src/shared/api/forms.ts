import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { publicApiClient } from './public-client';
import { unwrapApiResult } from './errors';

export type PublicForm = components['schemas']['PublicFormResponse'];
export type PublicFormField = components['schemas']['PublicFormField'];
export type PublishedForm = components['schemas']['FormResponse'];
export type FormCandidate = components['schemas']['FormFieldCandidate'];
export type FormCreateInput = components['schemas']['FormCreateRequest'];
export type FormSubmissionInput = components['schemas']['FormSubmitRequest'];
export type FormValue = string | number | boolean | string[] | null;

export async function fetchForms(tableId: string, signal?: AbortSignal): Promise<PublishedForm[]> {
  const data = unwrapApiResult(await apiClient.GET('/api/forms', { params: { query: { table_id: tableId } }, signal }));
  return data.forms;
}

export async function fetchFormCandidates(tableId: string, signal?: AbortSignal): Promise<FormCandidate[]> {
  const data = unwrapApiResult(await apiClient.GET('/api/forms/tables/{table_id}/fields', { params: { path: { table_id: tableId } }, signal }));
  return data.fields;
}

export async function publishForm(input: FormCreateInput): Promise<PublishedForm> {
  return unwrapApiResult(await apiClient.POST('/api/forms', { body: input }));
}

export async function revokeForm(formId: string): Promise<void> {
  unwrapApiResult(await apiClient.DELETE('/api/forms/{form_id}', { params: { path: { form_id: formId } } }));
}

export async function fetchPublicForm(token: string, signal?: AbortSignal): Promise<PublicForm> {
  return unwrapApiResult(await publicApiClient.GET('/api/forms/public/{token}', { params: { path: { token } }, signal }));
}

export async function submitPublicForm(token: string, input: FormSubmissionInput): Promise<void> {
  unwrapApiResult(await publicApiClient.POST('/api/forms/public/{token}/submissions', { params: { path: { token } }, body: input }));
}
