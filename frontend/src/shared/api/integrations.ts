import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type IntegrationsDocument = components['schemas']['IntegrationsDocument'];
export type IntegrationsUpdate = components['schemas']['IntegrationsUpdateRequest'];
export type CalendarSelection = components['schemas']['CalendarSelectionRequest'];
export type IntegrationUpdateResponse =
  components['schemas']['IntegrationUpdateResponse'];
type EmailConnectionTestRequest =
  components['schemas']['EmailConnectionTestRequest'];
export type EmailConnectionTestInput = Omit<
  EmailConnectionTestRequest,
  'imap_encryption' | 'smtp_encryption'
> & Partial<Pick<
  EmailConnectionTestRequest,
  'imap_encryption' | 'smtp_encryption'
>>;
export type DavConnectionTestInput =
  components['schemas']['DavConnectionTestRequest'];
export type IntegrationConnectionTestResult =
  components['schemas']['IntegrationConnectionTestResponse'];


export async function fetchIntegrations(
  signal?: AbortSignal,
): Promise<IntegrationsDocument> {
  return unwrapApiResult<IntegrationsDocument, unknown>(
    await apiClient.GET('/api/integrations', { signal }),
  );
}


export async function updateIntegration(
  integrationId: string,
  input: IntegrationsUpdate,
): Promise<IntegrationUpdateResponse> {
  return unwrapApiResult<IntegrationUpdateResponse, unknown>(
    await apiClient.PUT('/api/integrations/{integration_id}', {
      body: input,
      params: { path: { integration_id: integrationId } },
    }),
  );
}


async function updateIntegrationDocument(
  path: '/api/integrations/calendar_aliases' | '/api/integrations/calendar_colors',
  input: IntegrationsUpdate,
): Promise<IntegrationUpdateResponse> {
  return unwrapApiResult<IntegrationUpdateResponse, unknown>(
    await apiClient.PUT(path, { body: input }),
  );
}


export const updateCalendarAliases = (input: IntegrationsUpdate) =>
  updateIntegrationDocument('/api/integrations/calendar_aliases', input);


export const updateCalendarColors = (input: IntegrationsUpdate) =>
  updateIntegrationDocument('/api/integrations/calendar_colors', input);


export async function updateCalendarSelection(
  input: CalendarSelection,
): Promise<IntegrationUpdateResponse> {
  return unwrapApiResult<IntegrationUpdateResponse, unknown>(
    await apiClient.PUT('/api/integrations/calendar_selection', { body: input }),
  );
}


export async function updateDefaultCalendar(
  source: string,
): Promise<IntegrationUpdateResponse> {
  return unwrapApiResult<IntegrationUpdateResponse, unknown>(
    await apiClient.PUT('/api/integrations/default_calendar', {
      body: { source },
    }),
  );
}


async function updateDefaultAccount(
  path: '/api/integrations/default_contacts' | '/api/integrations/default_mail',
  email: string,
): Promise<IntegrationUpdateResponse> {
  return unwrapApiResult<IntegrationUpdateResponse, unknown>(
    await apiClient.PUT(path, { body: { email } }),
  );
}


export const updateDefaultContacts = (email: string) =>
  updateDefaultAccount('/api/integrations/default_contacts', email);


export const updateDefaultMail = (email: string) =>
  updateDefaultAccount('/api/integrations/default_mail', email);


export async function bulkUpdateIntegrations(
  input: IntegrationsUpdate,
): Promise<IntegrationUpdateResponse> {
  return unwrapApiResult<IntegrationUpdateResponse, unknown>(
    await apiClient.POST('/api/integrations/bulk', { body: input }),
  );
}


export async function testEmailIntegration(
  input: EmailConnectionTestInput,
): Promise<IntegrationConnectionTestResult> {
  return unwrapApiResult<IntegrationConnectionTestResult, unknown>(
    await apiClient.POST('/api/integrations/test-email', {
      body: {
        imap_encryption: 'ssl',
        smtp_encryption: 'ssl',
        ...input,
      },
    }),
  );
}


async function testDavIntegration(
  path: '/api/integrations/test-calendar' | '/api/integrations/test-contacts',
  input: DavConnectionTestInput,
): Promise<IntegrationConnectionTestResult> {
  return unwrapApiResult<IntegrationConnectionTestResult, unknown>(
    await apiClient.POST(path, { body: input }),
  );
}


export const testCalendarIntegration = (input: DavConnectionTestInput) =>
  testDavIntegration('/api/integrations/test-calendar', input);


export const testContactsIntegration = (input: DavConnectionTestInput) =>
  testDavIntegration('/api/integrations/test-contacts', input);
