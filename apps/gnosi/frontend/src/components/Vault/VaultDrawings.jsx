import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Palette, Calendar, HardDrive, Trash2, ExternalLink, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import ConfirmModal from '../ConfirmModal';

const API_BASE_URL = '/api/vault';

const VaultDrawings = ({ onDrawingSelect }) => {
    const [drawings, setDrawings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [drawingToDelete, setDrawingToDelete] = useState(null);

    const fetchDrawings = async () => {
        try {
            setLoading(true);
            const response = await axios.get(`${API_BASE_URL}/drawings`);
            setDrawings(response.data);
        } catch (error) {
            toast.error("Error carregant dibuixos");
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDrawings();
    }, []);

    const handleDeleteClick = (e, id) => {
        e.stopPropagation();
        setDrawingToDelete(id);
    };

    const confirmDelete = async () => {
        if (!drawingToDelete) return;
        try {
            await axios.delete(`${API_BASE_URL}/drawings/${drawingToDelete}`);
            toast.success("Dibuix eliminat");
            fetchDrawings();
        } catch (error) {
            console.error(error);
            toast.error("Error eliminant el dibuix");
        } finally {
            setDrawingToDelete(null);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                <Loader2 className="animate-spin mb-4" size={32} />
                <p>Buscant dibuixos...</p>
            </div>
        );
    }

    if (drawings.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400 border-2 border-dashed border-slate-100 rounded-xl m-6">
                <Palette size={48} className="mb-4 opacity-20" />
                <p>No hi ha cap dibuix encara.</p>
                <p className="text-sm">Crea'n un des del sidebar!</p>
            </div>
        );
    }

    return (
        <div className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {drawings.map((drawing) => (
                    <div
                        key={drawing.id}
                        onClick={() => onDrawingSelect(drawing.id, drawing.title)}
                        className="group relative bg-white border border-slate-200 rounded-xl overflow-hidden hover:shadow-xl hover:border-indigo-200 transition-all cursor-pointer flex flex-col"
                    >
                        <div className="aspect-video bg-slate-50 flex items-center justify-center border-bottom border-slate-100 overflow-hidden relative">
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
                                    {new Date(drawing.last_modified).toLocaleDateString()}
                                </span>
                                <span className="flex items-center gap-1">
                                    <HardDrive size={12} />
                                    {(drawing.size / 1024).toFixed(1)} KB
                                </span>
                            </div>
                        </div>

                        <button
                            onClick={(e) => handleDeleteClick(e, drawing.id)}
                            className="absolute top-2 right-2 p-2 bg-white/80 backdrop-blur shadow-sm rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>
                ))}
            </div>

            <ConfirmModal
                isOpen={!!drawingToDelete}
                onClose={() => setDrawingToDelete(null)}
                onConfirm={confirmDelete}
                title="Eliminar dibuix"
                message="N'estàs segur que vols eliminar permanentment aquest dibuix? Aquesta acció no es pot desfer i esborrarà el fitxer."
                confirmText="Eliminar"
                isDestructive={true}
            />
        </div>
    );
};

export default VaultDrawings;
