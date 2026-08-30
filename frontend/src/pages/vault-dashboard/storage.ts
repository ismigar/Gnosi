import { defineStorageKey, jsonStorageCodec } from '../../shared/platform/browser-storage';
import { isRecord } from './readers';
// Retain legacy truthy lock values, rather than silently changing their meaning.
export const EDIT_LOCKS = defineStorageKey('gnosi.vault.editLockedPages', jsonStorageCodec(isRecord));
