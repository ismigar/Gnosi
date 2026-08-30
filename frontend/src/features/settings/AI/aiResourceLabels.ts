import type { TFunction } from 'i18next';

import type { NormalizedOrigin } from './aiSettingsUtils';


export const effectLabel = (t: TFunction, effect: string): string => t(
    `settings.ai.resources.effects.${effect}`,
    { defaultValue: effect.replaceAll('_', ' ') },
);


export const originLabel = (t: TFunction, origin: NormalizedOrigin): string => {
    if (origin.type === 'plugin' && origin.id) {
        return t('settings.ai.resources.origin_plugin_name', { name: origin.id });
    }
    return t(`settings.ai.resources.origin_${origin.type}`, {
        defaultValue: origin.label,
    });
};
