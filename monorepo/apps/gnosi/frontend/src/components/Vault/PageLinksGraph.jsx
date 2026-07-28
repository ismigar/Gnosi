import React, { useMemo } from 'react';
import { buildPageLinksGraphModel, truncateGraphLabel } from './pageLinksGraphModel';

const VIEWBOX_WIDTH = 720;
const CENTER_X = VIEWBOX_WIDTH / 2;
const RING_CAPACITIES = [10, 16, 22];

const KIND_STYLES = {
    outgoing: {
        fill: 'var(--gnosi-primary)',
        edge: 'var(--gnosi-primary)',
    },
    incoming: {
        fill: 'var(--text-secondary)',
        edge: 'var(--text-tertiary)',
    },
    relation: {
        fill: '#6366f1',
        edge: '#6366f1',
    },
    mixed: {
        fill: '#8b5cf6',
        edge: '#8b5cf6',
    },
};

function positionGraphNodes(nodes) {
    let cursor = 0;
    let ringIndex = 0;
    const positioned = [];

    while (cursor < nodes.length) {
        const capacity = RING_CAPACITIES[Math.min(ringIndex, RING_CAPACITIES.length - 1)];
        const ringNodes = nodes.slice(cursor, cursor + capacity);
        const radiusX = 205 + ringIndex * 62;
        const radiusY = 78 + ringIndex * 58;

        ringNodes.forEach((node, index) => {
            const angle = (-Math.PI / 2) + ((Math.PI * 2 * index) / ringNodes.length);
            positioned.push({
                ...node,
                x: CENTER_X + Math.cos(angle) * radiusX,
                y: Math.sin(angle) * radiusY,
            });
        });

        cursor += ringNodes.length;
        ringIndex += 1;
    }

    const rings = Math.max(1, ringIndex);
    const height = 272 + Math.max(0, rings - 1) * 116;
    const centerY = height / 2;
    positioned.forEach((node) => {
        node.y += centerY;
    });

    return { nodes: positioned, height, centerY };
}

export function PageLinksGraph({
    currentTitle,
    outgoingLinks,
    incomingLinks,
    relatedPages,
    onOpenPage,
    labels,
}) {
    const model = useMemo(
        () => buildPageLinksGraphModel({ outgoingLinks, incomingLinks, relatedPages }),
        [outgoingLinks, incomingLinks, relatedPages]
    );
    const layout = useMemo(() => positionGraphNodes(model), [model]);
    const safeCurrentTitle = String(currentTitle || labels.untitled).trim() || labels.untitled;

    if (model.length === 0) {
        return (
            <div className="flex min-h-32 items-center justify-center text-xs text-[var(--text-tertiary)]/70">
                {labels.empty}
            </div>
        );
    }

    const activateNode = (node) => {
        if (node.id) onOpenPage(node.id);
    };

    return (
        <div className="w-full overflow-x-auto" data-testid="page-links-graph">
            <svg
                viewBox={`0 0 ${VIEWBOX_WIDTH} ${layout.height}`}
                className="block min-w-[560px] w-full"
                role="img"
                aria-label={labels.ariaLabel}
            >
                {layout.nodes.map((node) => {
                    const style = KIND_STYLES[node.visualKind];
                    return (
                        <line
                            key={`edge-${node.key}`}
                            x1={CENTER_X}
                            y1={layout.centerY}
                            x2={node.x}
                            y2={node.y}
                            stroke={style.edge}
                            strokeWidth={node.visualKind === 'mixed' ? 2.25 : 1.5}
                            strokeOpacity="0.4"
                        />
                    );
                })}

                {layout.nodes.map((node) => {
                    const style = KIND_STYLES[node.visualKind];
                    const kindText = node.kinds.map((kind) => labels[kind]).join(', ');
                    const tooltip = `${node.title} — ${kindText}`;
                    const isInteractive = Boolean(node.id);
                    return (
                        <g
                            key={node.key}
                            role={isInteractive ? 'button' : undefined}
                            tabIndex={isInteractive ? 0 : undefined}
                            aria-label={isInteractive ? tooltip : undefined}
                            className={isInteractive ? 'cursor-pointer outline-none group' : undefined}
                            onClick={() => activateNode(node)}
                            onKeyDown={(event) => {
                                if (!isInteractive || (event.key !== 'Enter' && event.key !== ' ')) return;
                                event.preventDefault();
                                activateNode(node);
                            }}
                        >
                            <title>{tooltip}</title>
                            <circle
                                cx={node.x}
                                cy={node.y}
                                r="17"
                                fill={style.fill}
                                fillOpacity={isInteractive ? '0.14' : '0.08'}
                                stroke={style.fill}
                                strokeWidth="2"
                                strokeOpacity={isInteractive ? '0.85' : '0.4'}
                                className={isInteractive ? 'group-hover:fill-opacity-25 group-focus:fill-opacity-25' : undefined}
                            />
                            <circle cx={node.x} cy={node.y} r="4.5" fill={style.fill} />
                            <text
                                x={node.x}
                                y={node.y + 30}
                                textAnchor="middle"
                                fontSize="11"
                                fontWeight="600"
                                fill="var(--text-secondary)"
                            >
                                {truncateGraphLabel(node.title)}
                            </text>
                        </g>
                    );
                })}

                <g>
                    <title>{safeCurrentTitle}</title>
                    <circle
                        cx={CENTER_X}
                        cy={layout.centerY}
                        r="29"
                        fill="var(--gnosi-primary)"
                        fillOpacity="0.16"
                        stroke="var(--gnosi-primary)"
                        strokeWidth="2.5"
                    />
                    <circle cx={CENTER_X} cy={layout.centerY} r="8" fill="var(--gnosi-primary)" />
                    <text
                        x={CENTER_X}
                        y={layout.centerY + 47}
                        textAnchor="middle"
                        fontSize="12"
                        fontWeight="700"
                        fill="var(--text-primary)"
                    >
                        {truncateGraphLabel(safeCurrentTitle, 26)}
                    </text>
                </g>
            </svg>
        </div>
    );
}
