// @vitest-environment node
import { bench, describe } from 'vitest';
import { buildVisibleLayout } from './graphViewerPhysics';
import { buildLegacyVisibleLayout, buildSyntheticPhysicsGraph } from './graphViewerPhysicsFixtures';

// Run from frontend, using the installed binary without reinstalling packages:
// ./node_modules/.bin/vitest bench src/shared/graph/viewer/graphViewerPhysics.bench.ts --run --maxWorkers=1 --minWorkers=1 --no-file-parallelism
// Measures layout input preparation only, excluding network, filters and D3 ticks.
// Both cases receive the same synthetic source graph, built outside timed work.
for (const nodeCount of [1000, 5000]) {
    describe(`visible layout preparation (${String(nodeCount)} synthetic nodes)`, () => {
        const graph = buildSyntheticPhysicsGraph(nodeCount);
        const options = { time: 300, iterations: 10, warmupTime: 100, warmupIterations: 5 };
        bench('before: Graphology subgraph copy', () => {
            buildLegacyVisibleLayout(graph);
        }, options);
        bench('after: direct D3 inputs', () => {
            buildVisibleLayout(graph);
        }, options);
    });
}
