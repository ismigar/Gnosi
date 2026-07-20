import React from 'react';
import { useTranslation } from 'react-i18next';

export function Controls({ onZoomIn, onZoomOut, onCenter, onFullscreen }) {
    const { t } = useTranslation();
    return (
        <div className="graph-controls">
            <button id="btn-fullscreen" title={t('graph.controls.fullscreen', 'Pantalla Completa')} onClick={onFullscreen}>⛶</button>
            <button id="btn-center" title={t('graph.controls.recenter', 'Recentrar')} onClick={onCenter}>⨁</button>
            <button id="btn-zoom-in" title={t('graph.controls.zoom_in', 'Ampliar')} onClick={onZoomIn}>＋</button>
            <button id="btn-zoom-out" title={t('graph.controls.zoom_out', 'Allunyar')} onClick={onZoomOut}>－</button>
        </div>
    );
}
