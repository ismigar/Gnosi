/* Word add-in task pane logic.
 *
 * taskpane.js is an IIFE: nothing escapes it, so there is no seam to import.
 * Each test loads the real index.html body into jsdom, stubs the host surface
 * (Office.js) and fetch, then evaluates the script in an isolated VM.
 * Assertions cover the rendered DOM, outgoing requests and Office calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, element, input, node } from './helpers/dom';
import { installFetch, request } from './helpers/network';
import { boot, mountWord, officeSettings, stubFetch, stubOffice } from './helpers/word-addin';

const TOKEN_KEY = 'gnosi.wordAddin.apiToken';
const AUTO_OPEN_SETTING = 'Office.AutoShowTaskpaneWithDocument';
const originalLocation = Object.getOwnPropertyDescriptor(window, 'location');
if (!originalLocation) throw new Error('The jsdom window has no location descriptor');

const statusText = () => node('connection-status').textContent;
const footer = () => node('status-line').textContent;

describe('word add-in task pane', () => {
  beforeEach(() => {
    mountWord();
    window.localStorage.clear();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { origin: 'https://localhost:5173' },
      writable: true,
    });
  });

  afterEach(() => {
    window.localStorage.clear();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'location', originalLocation);
    vi.restoreAllMocks();
  });

  it('reports the host it is running in', async () => {
    stubFetch();
    await boot(stubOffice({ host: 'Word' }));
    expect(footer()).toBe('Host: Word');
    expect(statusText()).toBe('Connected to Gnosi');
  });

  it('says "browser" when Office reports no host', async () => {
    stubFetch();
    await boot(stubOffice({ host: null }));
    expect(footer()).toBe('Host: browser');
  });

  it('sends no Authorization header when no token is stored', async () => {
    const fetchMock = stubFetch();
    await boot(stubOffice());
    expect(request(fetchMock, 'search-citations').headers.has('Authorization')).toBe(false);
    expect(request(fetchMock, 'limit=1').headers.has('Authorization')).toBe(false);
    expect(request(fetchMock, 'limit=50').headers.has('Authorization')).toBe(false);
    expect(node('token-state').textContent).toBe('No token');
  });

  it('sends the stored token as a bearer credential', async () => {
    window.localStorage.setItem(TOKEN_KEY, 'gnosi_pat_secret');
    const fetchMock = stubFetch();
    await boot(stubOffice());
    expect(request(fetchMock, 'limit=1').headers.get('Authorization')).toBe('Bearer gnosi_pat_secret');
    expect(request(fetchMock, 'limit=50').headers.get('Authorization')).toBe('Bearer gnosi_pat_secret');
    expect(input('token-input').value).toBe('');
    expect(node('token-state').textContent).toBe('Saved token: gnosi_pat_secr…');
  });

  it('targets the origin it is served from, not a hard-coded host', async () => {
    const fetchMock = stubFetch();
    await boot(stubOffice());
    const health = request(fetchMock, '/api/health');
    expect(health.url).toBe('https://localhost:5173/api/health');
    expect(health.init?.method).toBe('GET');
    expect(health.headers.has('Authorization')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const limit of ['1', '50']) {
      const url = new URL(request(fetchMock, `limit=${limit}`).url);
      expect(url.origin).toBe('https://localhost:5173');
      expect(url.pathname).toBe('/api/vault/search-citations');
      expect(url.searchParams.get('q')).toBe('');
      expect(url.searchParams.get('limit')).toBe(limit);
    }
  });

  it('distinguishes a missing token from a rejected one', async () => {
    const missingTokenFetch = stubFetch({ searchStatus: 401 });
    await boot(stubOffice());
    expect(statusText()).toBe('Token required');
    expect(element('settings', HTMLDetailsElement).open).toBe(true);
    expect(request(missingTokenFetch, 'search-citations').headers.has('Authorization')).toBe(false);

    mountWord();
    window.localStorage.setItem(TOKEN_KEY, 'gnosi_pat_revoked');
    const rejectedTokenFetch = stubFetch({ searchStatus: 401 });
    await boot(stubOffice());
    expect(statusText()).toBe('Invalid token');
    expect(element('settings', HTMLDetailsElement).open).toBe(true);
    expect(request(rejectedTokenFetch, 'search-citations').headers.get('Authorization')).toBe('Bearer gnosi_pat_revoked');
  });

  it('reports a 401 instead of rendering it as "no results"', async () => {
    const fetchMock = stubFetch({ searchStatus: 401 });
    await boot(stubOffice());
    expect(request(fetchMock, 'limit=50').headers.has('Authorization')).toBe(false);
    expect(statusText()).toBe('Token required');
    expect(node('connection-status').classList.contains('error')).toBe(true);
    expect(node('connection-status').classList.contains('connected')).toBe(false);
    expect(footer()).toBe('Configure a token to search the Vault');
    expect(element('settings', HTMLDetailsElement).open).toBe(true);
    expect(node('results').children).toHaveLength(0);
  });

  it('escapes markup from vault fields instead of injecting it', async () => {
    const citation = {
      citation_key: 'x1<script>alert("key")</script>',
      title: '<img src=x onerror="window.__pwned=1">',
      author: '<b>A & B</b>',
      year: '2020<svg onload="alert(1)">',
    };
    stubFetch({ items: [citation] });
    await boot(stubOffice());
    const results = node('results');
    expect(results.children).toHaveLength(1);
    expect(results.querySelector('img, script, b, svg, [onerror], [onload]')).toBeNull();
    expect(results.querySelector('.result-key')?.textContent).toBe(`@${citation.citation_key}`);
    expect(results.querySelector('.result-title')?.textContent).toBe(citation.title);
    expect(results.querySelector('.result-meta')?.textContent).toBe(`${citation.author}, ${citation.year}`);
    expect(node('empty-state').style.display).toBe('none');
  });

  it('tags the document so Word reopens the pane by itself', async () => {
    const settings = officeSettings();
    stubFetch();
    await boot(stubOffice({ host: 'Word', settings }));
    expect(settings.get).toHaveBeenCalledWith(AUTO_OPEN_SETTING);
    expect(settings.set).toHaveBeenCalledExactlyOnceWith(AUTO_OPEN_SETTING, true);
    expect(settings.saveAsync).toHaveBeenCalledOnce();
  });

  it('does not re-tag a document that is already tagged', async () => {
    const settings = officeSettings(true);
    stubFetch();
    await boot(stubOffice({ host: 'Word', settings }));
    expect(settings.get).toHaveBeenCalledWith(AUTO_OPEN_SETTING);
    expect(settings.set).not.toHaveBeenCalled();
    expect(settings.saveAsync).not.toHaveBeenCalled();
  });

  it('does not tag anything when running outside a real host', async () => {
    const settings = officeSettings();
    stubFetch();
    await boot(stubOffice({ host: null, settings }));
    expect(settings.get).not.toHaveBeenCalled();
    expect(settings.set).not.toHaveBeenCalled();
    expect(settings.saveAsync).not.toHaveBeenCalled();
  });

  it('survives a settings API that throws', async () => {
    const failure = new Error('no settings here');
    const settings = officeSettings();
    settings.get.mockImplementation(() => { throw failure; });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stubFetch();
    await boot(stubOffice({ host: 'Word', settings }));
    expect(error).toHaveBeenCalledExactlyOnceWith('Gnosi Cite: auto-open tagging failed', failure);
    expect(settings.set).not.toHaveBeenCalled();
    expect(settings.saveAsync).not.toHaveBeenCalled();
    expect(footer()).toBe('Host: Word');
    expect(statusText()).toBe('Connected to Gnosi');
  });

  it('stays usable when the backend is unreachable', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = installFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    await boot(stubOffice());
    expect(request(fetchMock, '/api/health').init?.method).toBe('GET');
    expect(request(fetchMock, 'limit=50').url).toContain('/api/vault/search-citations');
    expect(statusText()).toBe('No connection to Gnosi');
    expect(node('connection-status').classList.contains('error')).toBe(true);
    expect(input('search-input').disabled).toBe(false);
    expect(button('token-save').disabled).toBe(false);
    expect(warning).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledWith('Gnosi ping failed:', 'ECONNREFUSED');
    expect(warning).toHaveBeenCalledWith('search failed:', 'ECONNREFUSED');
  });
});
