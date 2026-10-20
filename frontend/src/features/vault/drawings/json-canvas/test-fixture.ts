export const canvasFixture = {
    version: 'extension-version', custom: { plugin: ['keep', 42] },
    nodes: [
        { id: 'group', type: 'group', x: -10, y: -20, width: 800, height: 600, label: 'Research', background: 'images/background.png', backgroundStyle: 'ratio', plugin: { nested: true } },
        { id: 'text', type: 'text', x: 20, y: 30, width: 240, height: 200, text: '# Note\nLong **Markdown**', color: '1', unknown: ['retain'] },
        { id: 'file', type: 'file', x: 320, y: 30, width: 240, height: 200, file: 'Notes/Source.md', subpath: '#Heading' },
        { id: 'link', type: 'link', x: 20, y: 280, width: 240, height: 200, url: 'https://example.test', color: '#12AB89' },
    ],
    edges: [ { id: 'edge', fromNode: 'text', toNode: 'file', fromSide: 'right', toSide: 'left', fromEnd: 'none', toEnd: 'arrow', color: '#AB12EF', label: 'supports', plugin: { line: 'keep' } } ],
};
