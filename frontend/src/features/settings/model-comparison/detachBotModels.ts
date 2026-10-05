import type { SettingsAgent } from '../global-settings/types';

type Route = { readonly provider: string; readonly model: string };
/** Keep unrelated bot settings when a registry transaction removes bindings. */
export function detachBotModels<T extends Partial<SettingsAgent>>(bot: T, routes: readonly Route[]): T {
    const matches = (value: Route) => routes.some(route => route.provider.toLowerCase() === value.provider.toLowerCase() && route.model === value.model);
    if (!matches({ provider: bot.provider || '', model: bot.model || '' })
        && !bot.model_strategy?.allowed_models.some(matches)
        && !bot.team?.temporary.models.some(matches)) return bot;
    return { ...bot,
        ...(matches({ provider: bot.provider || '', model: bot.model || '' }) ? { provider: '', model: '', reasoning_effort: null } : {}),
        ...(bot.model_strategy ? { model_strategy: { ...bot.model_strategy, allowed_models: bot.model_strategy.allowed_models.filter(value => !matches(value)) } } : {}),
        ...(bot.team ? { team: { ...bot.team, temporary: { ...bot.team.temporary, models: bot.team.temporary.models.filter(value => !matches(value)) } } } : {}),
    };
}
