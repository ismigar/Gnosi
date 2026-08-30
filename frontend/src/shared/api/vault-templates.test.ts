import { resetApiTestStorage } from '../../test/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createVaultFromTemplate,
  downloadVaultTemplate,
  fetchVaultTemplateCatalog,
  fetchVaultTemplateExportPreview,
  submitVaultTemplate,
  type VaultTemplateExportInput,
} from './vault-templates';


function requestAt(
  calls: [RequestInfo | URL, RequestInit?][],
  index: number,
): Request {
  const call = calls[index];
  if (!call) throw new Error(`Expected fetch call ${String(index)}`);
  const [input, init] = call;
  return input instanceof Request
    ? input
    : new Request(new URL(String(input), window.location.origin), init);
}


const exportInput: VaultTemplateExportInput = {
  acknowledgeFindings: true,
  author: 'Ismael',
  categories: ['research'],
  description: 'Research Vault',
  id: 'research',
  languages: ['ca'],
  license: 'CC-BY-4.0',
  minGnosiVersion: '',
  name: 'Research',
  preview: '',
  recommendedPlugins: [],
  version: '1.0.0',
};


afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
});


describe('Vault template API', () => {
  it('uses generated JSON contracts and the specialized binary transport', async () => {
    const catalog = {
      submissionConfigured: true,
      templates: [{ id: 'research', name: 'Research', version: '1.0.0' }],
    };
    const preview = { excluded: [], findings: [], included: [], totalSize: 3 };
    const created = {
      id: 'vault-1',
      name: 'Research',
      path: '/vaults/research',
      signedBy: 'official',
      template: { id: 'research', version: '1.0.0' },
    };
    const submitted = { status: 'submitted' };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(catalog))
      .mockResolvedValueOnce(Response.json(preview))
      .mockResolvedValueOnce(Response.json(created))
      .mockResolvedValueOnce(Response.json(submitted))
      .mockResolvedValueOnce(new Response(new TextEncoder().encode('zip'), {
        headers: { 'Content-Type': 'application/zip' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchVaultTemplateCatalog()).resolves.toEqual(catalog);
    await expect(fetchVaultTemplateExportPreview('vault one')).resolves.toEqual(preview);
    await expect(createVaultFromTemplate({
      name: 'Research',
      template_id: 'research',
      version: '1.0.0',
    })).resolves.toEqual(created);
    await expect(submitVaultTemplate('vault one', exportInput)).resolves.toEqual(
      submitted,
    );
    const archive = await downloadVaultTemplate('vault one', exportInput);
    expect(archive.size).toBe(3);
    expect(archive.type).toBe('application/zip');
    await expect(archive.text()).resolves.toBe('zip');

    expect(new URL(requestAt(fetchMock.mock.calls, 0).url).pathname).toBe(
      '/api/vaults/templates/catalog',
    );
    expect(new URL(requestAt(fetchMock.mock.calls, 1).url).pathname).toBe(
      '/api/vaults/vault%20one/template-export/preview',
    );
    await expect(requestAt(fetchMock.mock.calls, 2).json()).resolves.toEqual({
      name: 'Research',
      template_id: 'research',
      version: '1.0.0',
    });
    await expect(requestAt(fetchMock.mock.calls, 3).json()).resolves.toEqual(exportInput);
    const binaryRequest = requestAt(fetchMock.mock.calls, 4);
    expect(new URL(binaryRequest.url).pathname).toBe(
      '/api/vaults/vault%20one/template-export',
    );
    await expect(binaryRequest.json()).resolves.toEqual(exportInput);
  });


  it('normalizes JSON errors from binary exports', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(() => Promise.resolve(Response.json(
      { detail: 'Privacy findings must be acknowledged' },
      { status: 400, statusText: 'Bad Request' },
    ))));

    await expect(downloadVaultTemplate('vault-1', exportInput)).rejects.toMatchObject({
      message: 'Privacy findings must be acknowledged',
      name: 'GnosiApiError',
      status: 400,
    });
  });
});
