import type { RefObject } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { GraphViewer } from '../../../components/GraphViewer';
import { Minimap } from '../../../components/Minimap';
import { NodeDetailsPanel } from '../../../components/NodeDetailsPanel';
import type {
  GraphPageController,
  GraphViewerHandle,
} from './useGraphPageController';


interface GraphCanvasViewProps {
  readonly controller: GraphPageController;
  readonly graphViewerRef: RefObject<GraphViewerHandle | null>;
}


export function GraphCanvasView({
  controller,
  graphViewerRef,
}: GraphCanvasViewProps) {
  const { t } = useTranslation();
  const selectedAttributes = controller.selectedNode && controller.graphInstance
    ? controller.graphInstance.getNodeAttributes(controller.selectedNode)
    : null;
  return (
    <div style={{ height: '100%', position: 'relative', minHeight: '600px' }}>
      {controller.graphData?.partial && (
        <div
          className="absolute top-4 left-1/2 -translate-x-1/2 z-30 max-w-xl px-4 py-2 bg-amber-50 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 rounded-lg shadow-md flex items-center gap-3"
          title={(controller.graphData.skipped_dirs ?? []).join('\n')}
        >
          <AlertTriangle
            size={18}
            className="text-amber-600 dark:text-amber-400 shrink-0"
          />
          <span className="text-sm text-amber-800 dark:text-amber-200">
            <strong>{t('graph.partial_warning.title', 'Partial graph')}:</strong>{' '}
            {t('graph.partial_warning.message', {
              count: (controller.graphData.skipped_dirs ?? []).length,
              defaultValue: '{{count}} vault folders could not be read (cloud still syncing); the graph is incomplete.',
            })}
          </span>
          <button
            onClick={() => { void controller.fetchGraphData(); }}
            className="shrink-0 px-2.5 py-1 text-xs font-medium rounded-md bg-amber-600 hover:bg-amber-700 text-white"
          >
            {t('graph.partial_warning.retry', 'Retry')}
          </button>
        </div>
      )}
      <GraphViewer
        ref={handle => { graphViewerRef.current = handle; }}
        graphData={controller.graphData}
        setGraphInstance={controller.setGraphInstance}
        setRendererInstance={controller.setRendererInstance}
        filters={controller.filters}
        isPhysicsEnabled
        onNodeClick={controller.setSelectedNode}
        isPathfindingMode={controller.isPathfindingMode}
        pathSource={controller.pathSource}
        pathTarget={controller.pathTarget}
        onSelectPathNode={controller.selectPathNode}
        showArrows={controller.showArrows}
        labelThreshold={controller.labelThreshold}
        nodeSize={controller.nodeSize}
        edgeThickness={controller.edgeThickness}
        gravity={controller.gravity}
        repulsion={controller.repulsion}
        friction={controller.friction}
        edgeInfluence={controller.edgeInfluence}
        linLogMode={controller.linLogMode}
        strongGravityMode={controller.strongGravityMode}
        outboundAttractionDistribution={controller.outboundAttractionDistribution}
      />
      <Minimap
        graph={controller.graphInstance}
        mainRenderer={controller.rendererInstance}
        isDarkMode={controller.isDarkMode}
        onPanToGraph={(x, y, ratio) => {
          graphViewerRef.current?.panToGraphPoint(x, y, ratio);
        }}
        onPanToNode={(nodeId, ratio) => {
          graphViewerRef.current?.panToNode(nodeId, ratio);
        }}
        onCenter={() => { graphViewerRef.current?.center(); }}
      />
      <NodeDetailsPanel
        nodeId={controller.selectedNode}
        initialData={selectedAttributes}
        isOpen={Boolean(controller.selectedNode)}
        onClose={() => { controller.setSelectedNode(null); }}
      />
    </div>
  );
}
