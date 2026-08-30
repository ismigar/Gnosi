import { afterEach, describe, expect, it, vi } from 'vitest';
import { input, node, option, select } from './dom';
import { memoryStorage } from './memory-storage';
import { installFetch, jsonResponse, request, requestBody } from './network';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('typed script test boundaries', () => {
  it('implements the complete isolated Storage interface', () => {
    const storage = memoryStorage({ language: 'ca' });
    expect(storage.length).toBe(1);
    expect(storage.key(0)).toBe('language');
    expect(storage.key(1)).toBeNull();
    storage.setItem('token', 'fixture');
    storage.removeItem('language');
    expect(storage.getItem('language')).toBeNull();
    expect(storage.getItem('token')).toBe('fixture');
    storage.clear();
    expect(storage.length).toBe(0);
  });

  it('requires the actual DOM control type and an existing option', () => {
    document.body.innerHTML = '<div id="status"></div><input id="token"><select id="topics"><option>IA</option></select>';
    expect(input('token').value).toBe('');
    expect(node('status').tagName).toBe('DIV');
    expect(() => input('status')).toThrow('Missing HTMLInputElement');
    expect(() => node('absent')).toThrow('Missing HTMLElement');
    expect(option(select('topics'), 0).textContent).toBe('IA');
    expect(() => option(select('topics'), 1)).toThrow('Missing option');
  });

  it('records real request headers and decodes object bodies', async () => {
    const fetch = installFetch(() => Promise.resolve(jsonResponse({ saved: true })));
    const response = await fetch('/clip', { headers: { Authorization: 'Bearer fixture' }, body: '{"tags":["IA"]}' });
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({ saved: true });
    expect(request(fetch, '/clip').headers.get('authorization')).toBe('Bearer fixture');
    expect(requestBody(fetch)).toEqual({ tags: ['IA'] });
    expect(() => request(fetch, '/missing')).toThrow('Missing fixture request');
  });

  it('rejects unconfigured requests and malformed JSON bodies', async () => {
    const missing = installFetch();
    await expect(missing('/unexpected')).rejects.toThrow('Unexpected fixture request');
    const fetch = installFetch(() => Promise.resolve(jsonResponse()));
    await fetch('/no-body');
    await fetch('/array', { body: '[]' });
    await fetch('/invalid', { body: '{' });
    expect(() => requestBody(fetch, '/no-body')).toThrow('Expected a JSON string');
    expect(() => requestBody(fetch, '/array')).toThrow('Expected a JSON object');
    expect(() => requestBody(fetch, '/invalid')).toThrow(SyntaxError);
  });
});
