import { getSemanticOverlaySegments, SEMANTIC_SUGGESTION_COLOR } from '../../utils/semanticOverlay';
import type { OptionsRef, RuntimeRef, ViewerGraph, ViewerRenderer } from './types';
export function attachSemanticOverlay(renderer: ViewerRenderer, graph: ViewerGraph, runtime: RuntimeRef, options: OptionsRef): () => void {
    const semanticCanvas = renderer.createCanvas('semanticSuggestions', {
        beforeLayer: 'nodes',
        style: { pointerEvents: 'none' },
    });
    const semanticContext = semanticCanvas.getContext('2d');
    const drawSemanticSuggestions = () => {
        if (!semanticContext)
            return;
        const { width, height } = renderer.getDimensions();
        const pixelRatio = window.devicePixelRatio || 1;
        const pixelWidth = Math.max(1, Math.round(width * pixelRatio));
        const pixelHeight = Math.max(1, Math.round(height * pixelRatio));
        if (semanticCanvas.width !== pixelWidth || semanticCanvas.height !== pixelHeight) {
            semanticCanvas.width = pixelWidth;
            semanticCanvas.height = pixelHeight;
            semanticCanvas.style.width = `${String(width)}px`;
            semanticCanvas.style.height = `${String(height)}px`;
        }
        semanticContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        semanticContext.clearRect(0, 0, width, height);
        const segments = getSemanticOverlaySegments(runtime.current.semanticEdges, graph, (point) => renderer.graphToViewport(point));
        if (segments.length === 0)
            return;
        semanticContext.save();
        semanticContext.strokeStyle = SEMANTIC_SUGGESTION_COLOR;
        semanticContext.lineCap = 'round';
        semanticContext.lineWidth = Math.max(1, 1.35 * options.current.edgeThickness);
        semanticContext.setLineDash([6, 5]);
        semanticContext.globalAlpha = 0.78;
        segments.forEach(({ source, target }) => {
            semanticContext.beginPath();
            semanticContext.moveTo(source.x, source.y);
            semanticContext.lineTo(target.x, target.y);
            semanticContext.stroke();
        });
        semanticContext.restore();
    };
    renderer.on('afterRender', drawSemanticSuggestions);
    return () => { renderer.off('afterRender', drawSemanticSuggestions); };
}
