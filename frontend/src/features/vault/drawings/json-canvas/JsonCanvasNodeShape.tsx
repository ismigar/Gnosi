import { createElement } from 'react';
import { JsonCanvasNodeComponent } from './JsonCanvasNodeComponent';
import { BaseBoxShapeUtil, Rectangle2d, resizeBox, T, type RecordProps, type TLResizeInfo, type TLShape } from 'tldraw';
import { type JsonCanvasNode } from './model';

export const JSON_CANVAS_NODE = 'json-canvas-node' as const;
declare module '@tldraw/tlschema' {
    interface TLGlobalShapePropsMap {
        [JSON_CANVAS_NODE]: { w: number; h: number; data: string };
    }
}
export type JsonCanvasNodeShape = TLShape<typeof JSON_CANVAS_NODE>;
export class JsonCanvasNodeShapeUtil extends BaseBoxShapeUtil<JsonCanvasNodeShape> {
    static override type = JSON_CANVAS_NODE;
    static override props: RecordProps<JsonCanvasNodeShape> = { w: T.number, h: T.number, data: T.string };
    override getDefaultProps(): JsonCanvasNodeShape['props'] { return { w: 280, h: 200, data: '{"id":"","type":"text","text":""}' }; }
    override canResize() { return true; }
    override canEdit() { return false; }
    override canBind() { return true; }
    override getGeometry(shape: JsonCanvasNodeShape) { return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: (JSON.parse(shape.props.data) as JsonCanvasNode).type !== 'group' }); }
    override component(shape: JsonCanvasNodeShape) { return createElement(JsonCanvasNodeComponent, { shape }); }
    override getIndicatorPath(shape: JsonCanvasNodeShape) { const path = new Path2D(); path.roundRect(0, 0, shape.props.w, shape.props.h, 8); return path; }
    override onResize(shape: JsonCanvasNodeShape, info: TLResizeInfo<JsonCanvasNodeShape>) { return resizeBox(shape, info); }
}
