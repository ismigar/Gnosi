import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppHeader } from '../../shared/ui/layout/AppHeader';
import { getIntlLocale } from '../../shared/i18n/locales/registry';

export function HomeHeader({ children }: { readonly children?: ReactNode }) {
    const { i18n } = useTranslation();
    const [today, setToday] = useState(() => new Date());
    useEffect(() => {
        const next = new Date();
        next.setHours(24, 0, 0, 0);
        const timer = window.setTimeout(() => { setToday(new Date()); }, next.getTime() - Date.now());
        return () => { window.clearTimeout(timer); };
    }, [today]);
    const date = new Intl.DateTimeFormat(getIntlLocale(i18n.resolvedLanguage || i18n.language), { weekday: 'long', day: 'numeric', month: 'long' }).format(today);
    return <AppHeader title={date}>{children}</AppHeader>;
}
