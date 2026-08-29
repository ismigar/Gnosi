import { useEffect, useRef } from 'react';

import { mountSettingsPanel } from '../plugins/host';

export interface PluginSettingsPanelDefinition {
    readonly height?: number;
    readonly id: string;
    readonly pluginId: string;
    readonly title: string;
}

export interface PluginSettingsPanelProps {
    readonly panel?: PluginSettingsPanelDefinition | null;
}

export function PluginSettingsPanel({ panel }: PluginSettingsPanelProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!panel || !containerRef.current) return undefined;
        return mountSettingsPanel(panel.pluginId, panel.id, containerRef.current, panel.height);
    }, [panel]);

    if (!panel) return null;
    return (
        <section className="animate-in" aria-labelledby="plugin-settings-panel-title">
            <h2 id="plugin-settings-panel-title" className="mb-4 text-lg font-semibold">
                {panel.title}
            </h2>
            <div
                ref={containerRef}
                className="overflow-hidden rounded-2xl border border-[var(--settings-border)] bg-[var(--settings-sidebar-bg)]"
            />
        </section>
    );
}

export default PluginSettingsPanel;
