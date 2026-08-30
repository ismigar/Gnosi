import type { useSettingsCollections } from './useSettingsCollections';
import type { useSettingsState } from './useSettingsState';
import type { GlobalSettingsModalProps } from './types';

export type SettingsState = ReturnType<typeof useSettingsState> & ReturnType<typeof useSettingsCollections> & GlobalSettingsModalProps;
