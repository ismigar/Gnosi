import type { PluginManifest } from '../api/plugins';

export type HostArguments = Record<string, unknown>;

export interface PluginCommandContribution {
    icon: unknown;
    id: unknown;
    pluginId: string;
    title: unknown;
}

export type PluginViewContribution = PluginCommandContribution;

export interface PluginSidebarContribution {
    id: unknown;
    pluginId: string;
    title: unknown;
}

export interface PluginSettingsContribution extends PluginSidebarContribution {
    height: unknown;
}

export interface PluginHostContributions {
    commands: PluginCommandContribution[];
    settingsPanels: PluginSettingsContribution[];
    sidebar: PluginSidebarContribution[];
    views: PluginViewContribution[];
}

export interface PluginFrameEntry {
    generation: number;
    registeredPanels: Set<unknown>;
    panelMount?: { readonly panelId: string; rendered: boolean };
    granted: readonly string[];
    iframe: HTMLIFrameElement;
    unsubscribe?: () => void;
    manifest: PluginManifest;
}

export interface HostMethod {
    perm: string;
    run: (args: HostArguments, pluginId: string) => Promise<unknown>;
}

export type HostSubscriber = (snapshot: PluginHostContributions) => void;

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown): string {
    return Reflect.apply(String, undefined, [value || '']);
}

export function iframeWindow(iframe: HTMLIFrameElement): Window {
    const target = iframe.contentWindow;
    if (!target) throw new Error('Plugin iframe has no content window');
    return target;
}
