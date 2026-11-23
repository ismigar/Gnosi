import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ComponentProps, ReactNode } from 'react';
import type { AppPreviewItem } from '../../../shared/api/app-previews';
import { getIntlLocale } from '../../../shared/i18n/locales/registry';
import type { OptionalBlockKind } from './catalog';

export interface PreviewRow extends AppPreviewItem {
    readonly to?: ComponentProps<typeof Link>['to'];
    readonly externalUrl?: string;
    readonly onOpen?: () => void;
}

export function PreviewDate({ value }: { readonly value: number | string }) {
    const { i18n } = useTranslation();
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    const formatted = new Intl.DateTimeFormat(getIntlLocale(i18n.resolvedLanguage || i18n.language), {
        dateStyle: 'medium', timeStyle: 'short',
    }).format(date);
    return <time dateTime={date.toISOString()}>{formatted}</time>;
}

function RowTarget({ row, children }: { readonly row: PreviewRow; readonly children: ReactNode }) {
    if (row.to) return <Link className="home-preview__link" to={row.to}>{children}</Link>;
    if (row.externalUrl) return <a className="home-preview__link" href={row.externalUrl} target="_blank" rel="noopener noreferrer">{children}</a>;
    if (row.onOpen) return <button className="home-preview__link" type="button" onClick={row.onOpen}>{children}</button>;
    return <span>{children}</span>;
}

export function PreviewList({ kind, rows }: { readonly kind: OptionalBlockKind; readonly rows: readonly PreviewRow[] }) {
    const { t } = useTranslation();
    if (!rows.length) return <p className="home-block__state">{t(`home_canvas.apps.${kind}.empty`)}</p>;
    return <ul className="home-preview__list">{rows.map(row => {
        const title = kind === 'automations' ? t(`dashboard.tasks.${row.id}.title`, { defaultValue: row.title }) : row.title;
        return <li key={row.id} className="home-preview__item">
            <RowTarget row={row}>{title || t('home_canvas.apps.untitled')}</RowTarget>
            {row.detail && <span className="home-preview__detail">{row.detail}</span>}
            {row.count !== undefined && <span className="home-preview__detail">{t(`home_canvas.apps.${kind}.count`, { count: row.count })}</span>}
            {row.date && <span className="home-preview__detail"><PreviewDate value={row.date} /></span>}
        </li>;
    })}</ul>;
}
