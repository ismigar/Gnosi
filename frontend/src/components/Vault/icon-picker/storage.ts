import {
    defineStorageKey,
    jsonStorageCodec,
    readStorage,
    writeStorage,
} from '../../../shared/platform/browser-storage';
import { normalizeCustomIcons } from './model';


function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}


function isCustomIconList(value: unknown): value is string[] {
    return isUnknownArray(value) && value.every((item) => typeof item === 'string');
}


export const customIconStorageKey = defineStorageKey(
    'gnosi.vault.custom-icons',
    jsonStorageCodec(isCustomIconList),
);


export function readLocalCustomIcons(): string[] {
    return normalizeCustomIcons(readStorage(customIconStorageKey));
}


export function writeLocalCustomIcons(icons: readonly string[]): boolean {
    return writeStorage(customIconStorageKey, [...icons]);
}
