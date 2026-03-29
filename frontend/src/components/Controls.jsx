import React from 'react';

export function Controls({ onZoomIn, onZoomOut, onCenter, onFullscreen, isPhysicsEnabled, setIsPhysicsEnabled }) {
    return (
        <div className="graph-controls">
            <button
                id="btn-physics"
                title={isPhysicsEnabled ? "Aturar Física" : "Activar Física"}
                onClick={() => setIsPhysicsEnabled(!isPhysicsEnabled)}
                style={{ color: isPhysicsEnabled ? '#4CAF50' : 'inherit' }}
            >
                {isPhysicsEnabled ? "⏸️" : "▶️"}
            </button>
            <button id="btn-fullscreen" title="Pantalla Completa" onClick={onFullscreen}>⛶</button>
            <button id="btn-center" title="Recentrar" onClick={onCenter}>⨁</button>
            <button id="btn-zoom-in" title="Ampliar" onClick={onZoomIn}>＋</button>
            <button id="btn-zoom-out" title="Allunyar" onClick={onZoomOut}>－</button>
        </div>
    );
}
