import { createRoot } from 'react-dom/client';
import { initializeI18n } from '../../shared/i18n/i18n';
import { OfflineApp } from './OfflineApp';
import '../../shared/styles/tokens/theme.css';
import '../../shared/styles/base/document.css';
import '../../shared/styles/base/controls-loading.css';

// This entry intentionally has no auth bootstrap, plugin host or main-app router.
await initializeI18n(navigator.language);
const root = document.getElementById('root');
if (root) createRoot(root).render(<OfflineApp />);
