import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Palette, Calendar, HardDrive, Trash2, ExternalLink, Loader2 } from 'lucide-react';
import toast from '../../lib/toast';
import { logError } from '../../lib/notifyError';
import {
    deleteDrawing,
    listDrawings,
    type DrawingSummary,
} from '../../shared/api/drawings';
import ConfirmModal from '../ConfirmModal';

export interface VaultDrawingsProps {
    readonly onDrawingSelect: (id: string, title: string) => unknown;
}

const VaultDrawings = ({ onDrawingSelect }: VaultDrawingsProps) => {
    const { t } = useTranslation();
    const [drawings, setDrawings] = useState<DrawingSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [drawingToDelete, setDrawingToDelete] = useState<string | null>(null);

    const fetchDrawings = useCallback(async (): Promise<void> => {
        try {
            setLoading(true);
            setDrawings(await listDrawings());
        } catch (error) {
            toast.error(t('drawings.load_error', "Error loading drawings"));
            logError('vault-drawings-load', error);
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        queueMicrotask(() => {
            void fetchDrawings();
        });
    }, [fetchDrawings]);

    const handleDeleteClick = (e: MouseEvent<HTMLButtonElement>, id: string): void => {
        e.stopPropagation();
        setDrawingToDelete(id);
    };

    const confirmDelete = async (): Promise<void> => {
        if (!drawingToDelete) return;
        try {
            await deleteDrawing(drawingToDelete);
            toast.success(t('drawings.deleted', "Drawing deleted"));
            void fetchDrawings();
        } catch (error) {
            logError('vault-drawings-delete', error);
            toast.error(t('drawings.delete_error', "Error deleting the drawing"));
        } finally {
            setDrawingToDelete(null);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                <Loader2 className="animate-spin mb-4" size={32} />
                <p>{t('drawings.searching', "Searching for drawings...")}</p>
            </div>
        );
    }

    if (drawings.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400 border-2 border-dashed border-slate-100 rounded-xl m-6">
                <Palette size={48} className="mb-4 opacity-20" />
                <p>{t('drawings.empty_title', "There are no drawings yet.")}</p>
                <p className="text-sm">{t('drawings.empty_hint', "Create one from the sidebar!")}</p>
            </div>
        );
    }

    return (
        <div className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {drawings.map((drawing) => (
                    <div
                        key={drawing.id}
                        onClick={() => {
                            onDrawingSelect(drawing.id, drawing.title);
                        }}
                        className="group relative bg-white border border-slate-200 rounded-xl overflow-hidden hover:shadow-xl hover:border-indigo-200 transition-all cursor-pointer flex flex-col"
                    >
                        <div className="aspect-video bg-slate-50 flex items-center justify-center border-b border-slate-100 overflow-hidden relative">
                            <Palette size={40} className="text-slate-200 group-hover:text-indigo-100 transition-colors" />
                            {/* Aquí aniria la thumbnail SVG a la Fase 1.5 */}
                            <div className="absolute inset-0 bg-indigo-500/0 group-hover:bg-indigo-500/5 transition-colors flex items-center justify-center">
                                <ExternalLink size={24} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                        </div>

                        <div className="p-4">
                            <h3 className="font-semibold text-slate-800 truncate mb-1">{drawing.title}</h3>
                            <div className="flex items-center gap-3 text-[11px] text-slate-400 font-medium">
                                <span className="flex items-center gap-1">
                                    <Calendar size={12} />
                                    {drawing.last_modified ? new Date(drawing.last_modified).toLocaleDateString() : '—'}
                                </span>
                                <span className="flex items-center gap-1">
                                    <HardDrive size={12} />
                                    {Number.isFinite(drawing.size) ? `${(drawing.size / 1024).toFixed(1)} KB` : '—'}
                                </span>
                            </div>
                        </div>

                        <button
                            onClick={(e) => {
                                handleDeleteClick(e, drawing.id);
                            }}
                            className="absolute top-2 right-2 p-2 bg-white/80 backdrop-blur shadow-sm rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>
                ))}
            </div>

            <ConfirmModal
                isOpen={!!drawingToDelete}
                onClose={() => {
                    setDrawingToDelete(null);
                }}
                onConfirm={confirmDelete}
                title={t('drawings.delete_confirm_title', "Delete drawing")}
                message={t('drawings.delete_confirm_message', "Are you sure you want to permanently delete this drawing? This action cannot be undone and will delete the file.")}
                confirmText={t('common.delete', "Delete")}
                isDestructive={true}
            />
        </div>
    );
};

export default VaultDrawings;
