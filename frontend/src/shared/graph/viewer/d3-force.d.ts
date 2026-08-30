// Public subset used by the viewer, matching the locked d3-force 3 runtime.
// The workspace does not install @types/d3-force; no untyped module fallback.
declare module 'd3-force' {
    interface Node {
        x?: number;
        y?: number;
        vx?: number;
        vy?: number;
        fx?: number | null;
        fy?: number | null;
        index?: number;
    }
    interface Link<N extends Node> {
        source: string | number | N;
        target: string | number | N;
    }
    interface Force<N extends Node> {
        (alpha: number): void;
        initialize?(nodes: N[], random: () => number): void;
    }
    interface LinkForce<N extends Node, L extends Link<N>> extends Force<N> {
        id(accessor: (node: N, index: number, nodes: N[]) => string | number): this;
        distance(accessor: (link: L, index: number, links: L[]) => number): this;
        strength(accessor: (link: L, index: number, links: L[]) => number): this;
    }
    interface ManyBodyForce<N extends Node> extends Force<N> {
        strength(accessor: (node: N) => number): this;
        distanceMin(distance: number): this;
    }
    interface StrengthForce<N extends Node> extends Force<N> {
        strength(value: number): this;
    }
    interface Simulation<N extends Node> {
        force(name: string, force: Force<N> | null): this;
        velocityDecay(value: number): this;
        stop(): this;
        tick(iterations?: number): this;
        alpha(): number;
        alphaMin(): number;
    }
    export function forceSimulation<N extends Node>(nodes: N[]): Simulation<N>;
    export function forceLink<N extends Node, L extends Link<N>>(links: L[]): LinkForce<N, L>;
    export function forceManyBody<N extends Node>(): ManyBodyForce<N>;
    export function forceCenter<N extends Node>(x: number, y: number): Force<N>;
    export function forceX<N extends Node>(x: number): StrengthForce<N>;
    export function forceY<N extends Node>(y: number): StrengthForce<N>;
    export function forceCollide<N extends Node>(radius: (node: N) => number): StrengthForce<N>;
}
