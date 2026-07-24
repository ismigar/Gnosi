import React from 'react';
import { useTranslation } from 'react-i18next';

export function Controls({ onZoomIn, onZoomOut, onCenter, onFullscreen }) {
    const { t } = useTranslation();
    return (
        <div className="graph-controls">
            <button id="btn-fullscreen" title={t('graph.controls.fullscreen', "Fullscreen")} onClick={onFullscreen}>⛶</button>
            <button id="btn-center" title={t('graph.controls.recenter', "Recenter")} onClick={onCenter}>⨁</button>
            <button id="btn-zoom-in" title={t('graph.controls.zoom_in', "Zoom in")} onClick={onZoomIn}>＋</button>
            <button id="btn-zoom-out" title={t('graph.controls.zoom_out', "Zoom out")} onClick={onZoomOut}>－</button>
        </div>
    );
}
