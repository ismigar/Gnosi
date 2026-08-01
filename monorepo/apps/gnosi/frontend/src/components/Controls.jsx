import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

export function Controls({ onZoomIn, onZoomOut, onCenter, onFullscreen, legend }) {
    const { t } = useTranslation();
    const [isLegendHovered, setIsLegendHovered] = useState(false);
    const [isLegendFocused, setIsLegendFocused] = useState(false);
    const [isLegendPinned, setIsLegendPinned] = useState(false);
    const isLegendOpen = isLegendHovered || isLegendFocused || isLegendPinned;

    const closeLegendOnBlur = (event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
            setIsLegendFocused(false);
        }
    };

    return (
        <div className="graph-controls">
            {legend && (
                <div
                    className="graph-legend-control"
                    onMouseEnter={() => setIsLegendHovered(true)}
                    onMouseLeave={() => setIsLegendHovered(false)}
                    onFocus={() => setIsLegendFocused(true)}
                    onBlur={closeLegendOnBlur}
                >
                    <button
                        id="btn-legend"
                        type="button"
                        title={t('graph.controls.legend', 'Graph legend')}
                        aria-label={t('graph.controls.legend', 'Graph legend')}
                        aria-expanded={isLegendOpen}
                        aria-controls="graph-legend-tooltip"
                        onClick={() => setIsLegendPinned((isPinned) => !isPinned)}
                    >
                        ⓘ
                    </button>
                    <div
                        id="graph-legend-tooltip"
                        role="tooltip"
                        className={`graph-legend-tooltip${isLegendOpen ? ' graph-legend-tooltip--visible' : ''}`}
                    >
                        {legend}
                    </div>
                </div>
            )}
            <button id="btn-fullscreen" title={t('graph.controls.fullscreen', "Fullscreen")} onClick={onFullscreen}>⛶</button>
            <button
                id="btn-center"
                title={`${t('graph.controls.recenter', "Recenter")} (0)`}
                aria-keyshortcuts="0"
                onClick={onCenter}
            >
                ⨁
            </button>
            <button
                id="btn-zoom-in"
                title={`${t('graph.controls.zoom_in', "Zoom in")} (+)`}
                aria-keyshortcuts="+"
                onClick={onZoomIn}
            >
                ＋
            </button>
            <button
                id="btn-zoom-out"
                title={`${t('graph.controls.zoom_out', "Zoom out")} (-)`}
                aria-keyshortcuts="-"
                onClick={onZoomOut}
            >
                －
            </button>
        </div>
    );
}
