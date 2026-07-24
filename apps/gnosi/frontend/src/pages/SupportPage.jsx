import React from 'react';
import { ExternalLink, Heart, GitBranch, Coffee } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { trackOutboundClick } from '../lib/marketingAnalytics';

const GITHUB_SPONSORS_URL = 'https://gnosi.temenosismael.org/go/github-sponsors?utm_source=website&utm_medium=support&utm_campaign=github_sponsors';
const KO_FI_URL = 'https://gnosi.temenosismael.org/go/kofi?utm_source=website&utm_medium=support&utm_campaign=kofi';

function SupportPage() {
    const { t } = useTranslation();

    const openExternal = (url, destination) => {
        trackOutboundClick(destination);
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    return (
        <main className="support-page">
            <section className="support-page__hero">
                <Heart className="support-page__heart" size={42} aria-hidden="true" />
                <p className="support-page__eyebrow">{t('support.eyebrow')}</p>
                <h1>{t('support.title')}</h1>
                <p className="support-page__intro">{t('support.intro')}</p>
                <div className="support-page__actions">
                    <button type="button" className="btn-gnosi btn-gnosi--primary" onClick={() => openExternal(GITHUB_SPONSORS_URL, 'github_sponsors')}>
                        <GitBranch size={18} aria-hidden="true" />
                        {t('support.sponsor_button')}
                    </button>
                    <button type="button" className="btn-gnosi btn-gnosi--secondary" onClick={() => openExternal(KO_FI_URL, 'ko_fi')}>
                        <Coffee size={18} aria-hidden="true" />
                        {t('support.kofi_button')}
                    </button>
                </div>
            </section>

            <section className="support-page__grid" aria-label={t('support.tiers_label')}>
                {[
                    ['supporter', '3 €'],
                    ['backer', '10 €'],
                    ['sustainer', '25 €'],
                    ['cooperative', '50 €+'],
                ].map(([key, amount]) => (
                    <article className="support-tier" key={key}>
                        <p className="support-tier__amount">{amount}</p>
                        <h2>{t(`support.tiers.${key}.title`)}</h2>
                        <p>{t(`support.tiers.${key}.description`)}</p>
                    </article>
                ))}
            </section>

            <section className="support-page__details">
                <h2>{t('support.funding_title')}</h2>
                <p>{t('support.funding_description')}</p>
                <a href="https://github.com/ismigar/Gnosi" target="_blank" rel="noreferrer" onClick={() => trackOutboundClick('github_repository')}>
                    {t('support.github_link')} <ExternalLink size={15} aria-hidden="true" />
                </a>
            </section>
        </main>
    );
}

export default SupportPage;
