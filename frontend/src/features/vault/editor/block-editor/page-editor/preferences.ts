import { defineStorageKey, stringStorageCodec } from '../../../../../shared/platform/browser-storage';
export { readStorage, writeStorage } from '../../../../../shared/platform/browser-storage';
export const spellEnabledKey = defineStorageKey('gnosi_spell_enabled', stringStorageCodec);
export const vaultContrastKey = defineStorageKey('gnosi.vault.contrast', stringStorageCodec);
export const vaultTextSizeKey = defineStorageKey('gnosi.vault.textSize', stringStorageCodec);
