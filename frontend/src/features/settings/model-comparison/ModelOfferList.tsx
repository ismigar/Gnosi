import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ComparisonDetails } from './ComparisonDetails';

/** Keep a model row readable even when it has dozens of provider offers. */
export function ModelOfferList<T>({ offers, renderOffer, isHighlighted }: {
    readonly offers: readonly T[];
    readonly renderOffer: (offer: T, index: number) => ReactNode;
    readonly isHighlighted?: (offer: T) => boolean;
}) {
    const { t } = useTranslation();
    if (!offers.length) return null;
    const preview = offers.flatMap((offer, index) => index === 0 || isHighlighted?.(offer) ? [renderOffer(offer, index)] : []);
    if (offers.length === preview.length) return <div className="model-offer-list">{preview}</div>;
    return <ComparisonDetails className="model-offer-list" preview={preview}
        summary={t('model_comparison.additional_offers', { count: offers.length - preview.length })}>
        {() => <div className="model-offer-list__details">{offers.map(renderOffer)}</div>}
    </ComparisonDetails>;
}
