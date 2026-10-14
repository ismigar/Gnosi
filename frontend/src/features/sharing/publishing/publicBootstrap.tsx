import { createRoot } from 'react-dom/client';
import { initializeI18n } from '../../../shared/i18n/i18n';
import PublishedSite from './PublishedSite';

export async function bootstrapPublication(): Promise<void> {
    // Public visitors must not request private language settings or initialize
    // auth, routing, plugins, custom CSS, Vault cookies, or offline caches.
    await initializeI18n(navigator.language);
    const element = document.getElementById('root');
    if (!element) throw new Error('Gnosi root element was not found.');
    createRoot(element).render(<PublishedSite />);
}
