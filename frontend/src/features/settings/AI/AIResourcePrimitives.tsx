import { useState, type ReactNode } from 'react';
import {
    AlertTriangle,
    BadgeDollarSign,
    Bell,
    Check,
    ChevronDown,
    ChevronRight,
    CircleSlash2,
    CloudDownload,
    Code2,
    Coins,
    ExternalLink,
    FilePenLine,
    Files,
    Search,
    ShieldAlert,
    Sparkles,
    UserRound,
    Wrench,
    type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { effectLabel } from './aiResourceLabels';
import { resourceStatusLabel } from './aiResourceI18n';


const EFFECT_ICONS: Readonly<Partial<Record<string, LucideIcon>>> = {
    ai_cost: Coins,
    bulk_write: Files,
    code_execution: Code2,
    data_egress: ExternalLink,
    destructive: ShieldAlert,
    external_read: CloudDownload,
    external_write: ExternalLink,
    financial_cost: BadgeDollarSign,
    local_write: FilePenLine,
    notification: Bell,
    personal_data: UserRound,
    read: Search,
};


export function EffectBadges({ effects }: { readonly effects: readonly string[] }) {
    const { t } = useTranslation();
    if (effects.length === 0) {
        return (
            <span className="ai-resource-muted">
                {t('settings.ai.resources.no_effects')}
            </span>
        );
    }
    return (
        <div className="ai-resource-badges">
            {effects.map((effect) => {
                const Icon = EFFECT_ICONS[effect] ?? Wrench;
                return (
                    <span
                        className={`ai-resource-badge ai-resource-badge--${effect}`}
                        key={effect}
                    >
                        <Icon size={13} />
                        {effectLabel(t, effect)}
                    </span>
                );
            })}
        </div>
    );
}


export function ResourceState({
    available,
    status,
}: {
    readonly available: boolean;
    readonly status: string;
}) {
    const { t } = useTranslation();
    return (
        <span className={`ai-resource-status ${available
            ? 'is-available'
            : 'is-unavailable'}`}
        >
            {available ? <Check size={13} /> : <CircleSlash2 size={13} />}
            {resourceStatusLabel(t, status)}
        </span>
    );
}


export function EmptyState({ children }: { readonly children: ReactNode }) {
    return (
        <div className="ai-resource-empty">
            <Sparkles size={28} />
            <span>{children}</span>
        </div>
    );
}


export interface SearchFieldProps {
    readonly onChange: (value: string) => void;
    readonly placeholder: string;
    readonly value: string;
}


export function SearchField({
    onChange,
    placeholder,
    value,
}: SearchFieldProps) {
    return (
        <label className="ai-resource-search">
            <Search aria-hidden="true" size={16} />
            <input
                onChange={(event) => {
                    onChange(event.target.value);
                }}
                placeholder={placeholder}
                type="search"
                value={value}
            />
        </label>
    );
}


export function JsonSchemaDetails({
    label,
    schema,
}: {
    readonly label: string;
    readonly schema: unknown;
}) {
    const [open, setOpen] = useState(false);
    if (!schema) return null;
    return (
        <div className="ai-tool-schema">
            <button
                onClick={() => {
                    setOpen((current) => !current);
                }}
                type="button"
            >
                {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                {label}
            </button>
            {open ? <pre>{JSON.stringify(schema, null, 2)}</pre> : null}
        </div>
    );
}


export function CatalogError({
    error,
    onRetry,
}: {
    readonly error: string;
    readonly onRetry: () => Promise<void>;
}) {
    const { t } = useTranslation();
    if (!error) return null;
    return (
        <div className="ai-resource-alert is-error">
            <AlertTriangle size={17} />
            <span>{t('settings.ai.resources.load_error')}: {error}</span>
            <button
                className="btn-gnosi btn-gnosi-secondary"
                onClick={() => {
                    void onRetry();
                }}
                type="button"
            >
                {t('common.retry')}
            </button>
        </div>
    );
}
