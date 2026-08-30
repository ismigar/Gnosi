import { defineStorageKey, jsonStorageCodec, readStorage, stringStorageCodec, writeStorage } from '../../shared/platform/browser-storage';
import { isJsonRecord } from '../AI/aiResourcesApi';
import type { Snippet } from './types';

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
const isSnippets = (value: unknown): value is Snippet[] => Array.isArray(value) && value.every((item: unknown) => isJsonRecord(item) && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.content === 'string');
export const syncErrorsKey = defineStorageKey('gnosi_mail_sync_errors', jsonStorageCodec(isStrings));
export const snippetsKey = defineStorageKey('gnosi_mail_snippets', jsonStorageCodec(isSnippets));
export const mailDarkBodyKey = defineStorageKey('gnosi_mail_dark_body', stringStorageCodec);
export const themeKey = defineStorageKey('db-theme', stringStorageCodec);
export const configurePluginKey = defineStorageKey('gnosi:configure-plugin', stringStorageCodec, 'session');
export { readStorage, writeStorage };
