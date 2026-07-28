import React from 'react';
import { useTranslation } from 'react-i18next';
import Composer from '../components/social/Composer';
import { PenTool, Share2 } from 'lucide-react';
import { AppHeader } from '../components/AppHeader';

const ComposerPage = () => {
    const { t } = useTranslation();
    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg-secondary)] text-[var(--text-primary)]">
            <AppHeader
                icon={PenTool}
                title={t('composer.title', 'Composer')}
                subtitle={t('composer.subtitle', "Create and schedule content for your social networks.")}
            />
            <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
                <div className="mx-auto max-w-3xl">
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <Composer />
                </div>
                
                <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <a href="/social-dashboard" className="gnosi-panel group p-5 transition-all hover:border-[var(--gnosi-blue)]">
                        <div className="flex items-center gap-3 mb-2">
                            <Share2 className="text-[var(--text-secondary)] transition-colors group-hover:text-[var(--gnosi-blue)]" size={20} />
                            <h3 className="font-bold">{t('composer.social_dashboard_title', 'Social Dashboard')}</h3>
                        </div>
                        <p className="text-sm text-[var(--text-secondary)]">{t('composer.social_dashboard_desc', "Manage your social media streams and feeds.")}</p>
                    </a>
                </div>
                </div>
            </main>
        </div>
    );
};

export default ComposerPage;
