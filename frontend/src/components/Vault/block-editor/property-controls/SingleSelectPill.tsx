import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { eventTargetIsWithin, subscribeDocumentEvent } from '../../../../shared/platform/browser-events';
import type { SingleSelectPillProps } from './types';

export const SingleSelectPill = ({ value, onChange, options, idToTitle, placeholder }: SingleSelectPillProps) => {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !eventTargetIsWithin(containerRef.current, event.target)) {
                setIsOpen(false);
            }
        };
        return subscribeDocumentEvent('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="relative inline-block" ref={containerRef}>
            <div
                onClick={() => { setIsOpen(!isOpen); }}
                className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg cursor-pointer hover:border-[var(--gnosi-primary)]/50 transition-all shadow-sm"
            >
                <div className="w-2 h-2 rounded-full bg-[var(--gnosi-primary)]/60"></div>
                <span className="text-xs font-semibold text-[var(--text-primary)]">{idToTitle[value] || value || placeholder}</span>
                <ChevronDown size={14} className={`text-[var(--text-tertiary)]/60 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </div>
            {isOpen && (
                <div className="absolute z-[100] top-full mt-2 w-56 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-2xl p-1.5 animate-in fade-in zoom-in-95 duration-150">
                    <div className="text-[10px] font-bold text-[var(--text-tertiary)]/40 px-3 py-2 uppercase tracking-wider">{t('editor.select_table')}</div>
                    {(options || []).map(opt => (
                        <div
                            key={opt}
                            onClick={() => { onChange(opt); setIsOpen(false); }}
                            className={`p-2.5 text-sm rounded-lg cursor-pointer transition-colors flex items-center gap-3 ${value === opt ? 'bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] font-medium' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}
                        >
                            <div className={`w-1.5 h-1.5 rounded-full ${value === opt ? 'bg-[var(--gnosi-primary)]' : 'bg-[var(--text-tertiary)]/30'}`}></div>
                            {idToTitle[opt] || opt}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
