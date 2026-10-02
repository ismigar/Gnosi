import { BarChart3 } from 'lucide-react';
import type { SettingsController } from './useGlobalSettingsController';
type Props = { context: Pick<SettingsController, 'aiSection' | 'setAiSection' | 't'> };
export function ModelConsumption({ context }: Props) {
    if (context.aiSection !== 'models') return null;
    return <div className="ai-comparison-launcher">
        <div><strong>{context.t('settings.ai.consumption.title')}</strong><span>{context.t('settings.ai.consumption.subtitle')}</span></div>
        <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={() => { context.setAiSection('consumption'); }}><BarChart3 size={18} />{context.t('settings.ai.consumption.open')}</button>
    </div>;
}
