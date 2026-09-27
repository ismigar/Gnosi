import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ComparisonDetails } from './ComparisonDetails';

/** Keep a model row readable even when it has dozens of provider offers. */
export function ModelOfferList<T>({ offers, renderOffer }: {
    readonly offers: readonly T[];
    readonly renderOffer: (offer: T, index: number) => ReactNode;
}) {
    const { t } = useTranslation();
    if (!offers.length) return null;
    const preview = offers.slice(0, 1).map(renderOffer);
    if (offers.length === 1) return <div className="model-offer-list">{preview}</div>;
    return <ComparisonDetails className="model-offer-list" preview={preview}
        summary={t('model_comparison.additional_offers', { count: offers.length - 1 })}>
        {() => <div className="model-offer-list__details">{offers.map(renderOffer)}</div>}
    </ComparisonDetails>;
}
