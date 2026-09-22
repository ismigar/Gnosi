import { useTranslation } from 'react-i18next';

import type { LlmWikiController } from './llmWikiModel';

interface LlmWikiStatusProps {
    readonly controller: LlmWikiController;
}

export function LlmWikiStatus({ controller }: LlmWikiStatusProps) {
    const { t } = useTranslation();
    const tp = (key: string, fallback: string, values: Readonly<Record<string, unknown>> = {}): string => (
        t(`settings.plugins.${key}`, { defaultValue: fallback, ...values })
    );
    const capabilities = controller.serverState?.capabilities;
    return (
        <>
            {capabilities && (
                <div style={{ color: 'var(--text-tertiary)', fontSize: 11, lineHeight: 1.5 }}>
                    <div>{tp('llm_wiki_capabilities', 'OCR {{ocr}} · transcription {{transcription}} · streaming {{streaming}}', {
                        ocr: capabilities.ocr ? '✓' : '—',
                        streaming: capabilities.streaming ? '✓' : '—',
                        transcription: capabilities.transcription ? '✓' : '—',
                    })}</div>
                    {(!capabilities.ocr || !capabilities.transcription || !capabilities.streaming || capabilities.ocr_missing_languages.length > 0) && (
                        <div style={{ color: 'var(--status-warning, #b45309)', marginTop: 3 }}>
                            {tp('llm_wiki_capability_help', 'Install Tesseract (ca/es/en/fr), FFmpeg, and the Python dependencies locked with uv, then restart the native backend.')}
                            {capabilities.ocr_missing_languages.length > 0 && (
                                <span style={{ display: 'block' }}>{tp('llm_wiki_missing_ocr_languages', 'Missing OCR languages: {{languages}}.', { languages: capabilities.ocr_missing_languages.join(', ') })}</span>
                            )}
                        </div>
                    )}
                </div>
            )}
        </>
    );
}
