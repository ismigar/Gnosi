import { GlobalSettingsView } from './global-settings/GlobalSettingsView';
import { useGlobalSettingsController } from './global-settings/useGlobalSettingsController';
import type { GlobalSettingsModalProps } from './global-settings/types';
import './GlobalSettingsModal.css';
import './AI/AIResourcesSettings.css';

export { FormGroup, GnosiToggle, Section } from '../../shared/ui/settings/SettingsPrimitives';
export type { GlobalSettingsModalProps } from './global-settings/types';

export function GlobalSettingsModal(props: GlobalSettingsModalProps) {
    return <GlobalSettingsView context={useGlobalSettingsController(props)} />;
}
