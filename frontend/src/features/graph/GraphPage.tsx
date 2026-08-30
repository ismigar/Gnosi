import { ConnectionList } from './panels/ConnectionList';
import { Controls } from './panels/Controls';
import { GraphLoadingState } from '../../components/GraphLoadingState';
import { Layout } from '../../components/Layout';
import { Legend } from './panels/Legend';
import '../../viewer/style.css';
import { GraphCanvasView } from './page/GraphCanvasView';
import { GraphSidebarView } from './page/GraphSidebarView';
import {
  useGraphPageController,
} from './page/useGraphPageController';


export default function GraphPage() {
  const { controller, graphViewerRef } = useGraphPageController();
  if (controller.loading) {
    return <GraphLoadingState progress={controller.loadingProgress} />;
  }
  return (
    <Layout
      sidebar={<GraphSidebarView controller={controller} />}
      controls={(
        <Controls
          onZoomIn={() => { graphViewerRef.current?.zoomIn(); }}
          onZoomOut={() => { graphViewerRef.current?.zoomOut(); }}
          onCenter={() => { graphViewerRef.current?.center(); }}
          onFullscreen={() => { graphViewerRef.current?.fullscreen(); }}
          legend={(
            <Legend
              graphData={controller.graphData}
              colorMode={controller.colorMode}
              filteredNodesCount={controller.graphCounts.nodes}
              filteredEdgesCount={controller.graphCounts.edges}
              connectionTypeCounts={controller.graphCounts.types}
            />
          )}
        />
      )}
      bottomPanel={(
        <div style={{
          padding: '20px',
          background: controller.isDarkMode ? '#111' : '#f7f7f7',
        }}>
          <ConnectionList
            graphInstance={controller.graphInstance}
            graphData={controller.graphData}
            filters={controller.filters}
          />
        </div>
      )}
      containerStyle={{ display: 'block' }}
    >
      <GraphCanvasView controller={controller} graphViewerRef={graphViewerRef} />
    </Layout>
  );
}
