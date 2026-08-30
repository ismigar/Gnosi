import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface DashboardPaginationControlsProps {
    readonly limit: number;
    readonly loading?: boolean;
    readonly onPageChange: (page: number) => void;
    readonly page: number;
    readonly total: number;
}

export function DashboardPaginationControls({
    total,
    limit,
    page,
    onPageChange,
    loading = false,
}: DashboardPaginationControlsProps) {
    const { t } = useTranslation();
    const totalPages = Math.ceil((total || 0) / (limit || 1));

    if (totalPages <= 1 || Number.isNaN(totalPages)) return null;

    return (
        <div className="flex items-center justify-between mt-4 px-2 py-4 border-t border-[var(--border-primary)]">
            <div className="text-[10px] text-[var(--text-secondary)] font-bold uppercase tracking-widest">
                {t('dashboard.pagination_range', {
                    start: page * limit + 1,
                    end: Math.min((page + 1) * limit, total),
                    total
                })}
            </div>
            <div className="flex items-center gap-1">
                <button
                    type="button"
                    onClick={() => {
                        onPageChange(page - 1);
                    }}
                    disabled={page === 0 || loading}
                    aria-label={t('common.previous')}
                    className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] disabled:opacity-30 transition-all text-[var(--text-secondary)]"
                >
                    <ChevronLeft size={16} />
                </button>

                <div className="flex items-center gap-1">
                    {Array.from({ length: totalPages }, (_, index) => index).map((index) => {
                        if (
                            totalPages > 7
                            && index > 0
                            && index < totalPages - 1
                            && Math.abs(index - page) > 1
                        ) {
                            if (index === 1 || index === totalPages - 2) {
                                return <span key={index} className="px-1 text-[10px] opacity-30">...</span>;
                            }
                            return null;
                        }

                        return (
                            <button
                                key={index}
                                type="button"
                                onClick={() => {
                                    onPageChange(index);
                                }}
                                disabled={loading}
                                aria-label={t('dashboard.pagination_page', { page: index + 1 })}
                                aria-current={page === index ? 'page' : undefined}
                                className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${
                                    page === index
                                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                                        : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                                }`}
                            >
                                {index + 1}
                            </button>
                        );
                    })}
                </div>

                <button
                    type="button"
                    onClick={() => {
                        onPageChange(page + 1);
                    }}
                    disabled={page >= totalPages - 1 || loading}
                    aria-label={t('common.next')}
                    className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] disabled:opacity-30 transition-all text-[var(--text-secondary)]"
                >
                    <ChevronRight size={16} />
                </button>
            </div>
        </div>
    );
}
