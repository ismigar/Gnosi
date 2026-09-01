import { useTranslation } from 'react-i18next';

import { ForcesSection } from '../panels/ForcesSection';
import { Sidebar } from '../panels/Sidebar';
import { VisualizationSection } from '../panels/VisualizationSection';
import { GraphFilterSections } from './GraphFilterSections';
import type { GraphPageController } from './useGraphPageController';


interface GraphSidebarViewProps {
  readonly controller: GraphPageController;
}


export function GraphSidebarView({ controller }: GraphSidebarViewProps) {
  const { t } = useTranslation();
  const getNodeLabel = (nodeId: string): string => {
    const label = controller.graphInstance?.getNodeAttribute(nodeId, 'label');
    return typeof label === 'string' && label ? label : nodeId;
  };
  return (
    <Sidebar
      searchTerm={controller.searchTerm}
      onSearchChange={controller.setSearchTerm}
      showSemanticSuggestions={controller.showSemanticSuggestions}
      onShowSemanticSuggestionsChange={controller.setShowSemanticSuggestions}
      hasSemanticData={controller.hasSemanticData}
      hideIsolated={controller.hideIsolated}
      onHideIsolatedChange={controller.setHideIsolated}
      onlyIsolated={controller.onlyIsolated}
      onOnlyIsolatedChange={controller.setOnlyIsolated}
      onSearchSubmit={controller.handleSearchSubmit}
      minDate={controller.timelineRange?.[0] ?? null}
      maxDate={controller.timelineRange?.[1] ?? null}
      timelineDate={controller.timelineDate}
      onTimelineChange={controller.setTimelineDate}
      colorMode={controller.colorMode}
      onColorModeChange={controller.setColorMode}
      hasClusterData={controller.hasClusterData}
      isPathfindingMode={controller.isPathfindingMode}
      onPathfindingModeChange={controller.setIsPathfindingMode}
      pathSource={controller.pathSource}
      pathTarget={controller.pathTarget}
      onClearPath={() => {
        controller.setPathSource(null);
        controller.setPathTarget(null);
      }}
      pathResult={controller.pathResult}
      getNodeLabel={getNodeLabel}
      afterWidgets={(
        <div style={{ marginTop: '20px', paddingRight: '10px' }}>
          <VisualizationSection
            showArrows={controller.showArrows}
            onShowArrowsChange={controller.setShowArrows}
            labelThreshold={controller.labelThreshold}
            onLabelThresholdChange={controller.setLabelThreshold}
            nodeSize={controller.nodeSize}
            onNodeSizeChange={controller.setNodeSize}
            edgeThickness={controller.edgeThickness}
            onEdgeThicknessChange={controller.setEdgeThickness}
          />
          <ForcesSection
            gravity={controller.gravityUI}
            onGravityChange={controller.setGravityUI}
            repulsion={controller.repulsionUI}
            onRepulsionChange={controller.setRepulsionUI}
            friction={controller.frictionUI}
            onFrictionChange={controller.setFrictionUI}
            edgeInfluence={controller.edgeInfluenceUI}
            onEdgeInfluenceChange={controller.setEdgeInfluenceUI}
            linLogMode={controller.linLogMode}
            onLinLogModeChange={controller.setLinLogMode}
            strongGravityMode={controller.strongGravityMode}
            onStrongGravityModeChange={controller.setStrongGravityMode}
            outboundAttractionDistribution={controller.outboundAttractionDistribution}
            onOutboundAttractionDistributionChange={controller.setOutboundAttractionDistribution}
          />
        </div>
      )}
    >
      <GraphFilterSections controller={controller} />
      {controller.selectedNode && (
        <div className="section">
          <div id="depth-controls" className="depth-controls" style={{ display: 'block' }}>
            <p>{t('graph.selection.showing_neighbors_of', 'Showing neighbors of:')}</p>
            <strong>{getNodeLabel(controller.selectedNode)}</strong>
            <div className="depth-slider-container">
              <label htmlFor="depth-slider">{t('depth_filter')}:</label>
              <input
                type="range"
                id="depth-slider"
                min="1"
                max="5"
                value={controller.depth}
                step="1"
                onChange={(event) => {
                  controller.setDepth(Number.parseInt(event.target.value, 10));
                }}
              />
              <span id="depth-label">{controller.depth}</span>
            </div>
            <button
              id="clear-selection-btn"
              onClick={() => { controller.setSelectedNode(null); }}
            >
              {t('graph.selection.clear', 'Clear selection')}
            </button>
          </div>
        </div>
      )}
    </Sidebar>
  );
}
