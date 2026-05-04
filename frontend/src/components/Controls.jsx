import React from 'react';

export function Controls({ onZoomIn, onZoomOut, onCenter, onFullscreen }) {
    return (
        <div className="graph-controls">
            <button id="btn-fullscreen" title="Pantalla Completa" onClick={onFullscreen}>⛶</button>
            <button id="btn-center" title="Recentrar" onClick={onCenter}>⨁</button>
            <button id="btn-zoom-in" title="Ampliar" onClick={onZoomIn}>＋</button>
            <button id="btn-zoom-out" title="Allunyar" onClick={onZoomOut}>－</button>
        </div>
    );
}
