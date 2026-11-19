import { createElement } from 'react';
import { JsonCanvasNodeComponent } from './JsonCanvasNodeComponent';
import { BaseBoxShapeUtil, Rectangle2d, resizeBox, T, type ShapeProps, type TLResizeInfo, type TLBaseShape } from '@bigbluebutton/tldraw';
import { type JsonCanvasNode } from './model';

export const JSON_CANVAS_NODE = 'json-canvas-node' as const;
export type JsonCanvasNodeShape = TLBaseShape<typeof JSON_CANVAS_NODE, { w: number; h: number; data: string }>;
export class JsonCanvasNodeShapeUtil extends BaseBoxShapeUtil<JsonCanvasNodeShape> {
    static override type = JSON_CANVAS_NODE;
    static override props: ShapeProps<JsonCanvasNodeShape> = { w: T.number, h: T.number, data: T.string };
    override getDefaultProps(): JsonCanvasNodeShape['props'] { return { w: 280, h: 200, data: '{"id":"","type":"text","text":""}' }; }
    override canResize = () => true;
    override canEdit = () => false;
    override canBind = () => true;
    override getGeometry(shape: JsonCanvasNodeShape) { return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: (JSON.parse(shape.props.data) as JsonCanvasNode).type !== 'group' }); }
    override component(shape: JsonCanvasNodeShape) { return createElement(JsonCanvasNodeComponent, { shape }); }
    override indicator(shape: JsonCanvasNodeShape) { return createElement('rect', { width: shape.props.w, height: shape.props.h, rx: 8 }); }
    override onResize = (shape: JsonCanvasNodeShape, info: TLResizeInfo<JsonCanvasNodeShape>) => resizeBox(shape, info);
}
