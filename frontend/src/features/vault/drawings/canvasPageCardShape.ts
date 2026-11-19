import { createElement } from 'react';
import {
    BaseBoxShapeUtil,
    Rectangle2d,
    resizeBox,
    T,
    type ShapeProps,
    type TLResizeInfo,
} from '@bigbluebutton/tldraw';

import { PageCardComponent } from './canvas-page-card/PageCardComponent';
import {
    PAGE_CARD_TYPE,
    type PageCardShape,
} from './canvas-page-card/types';


export { CanvasPageContext } from './canvas-page-card/context';
export type { PageCardShape } from './canvas-page-card/types';


export class PageCardShapeUtil extends BaseBoxShapeUtil<PageCardShape> {
    static override type = PAGE_CARD_TYPE;
    static override props: ShapeProps<PageCardShape> = {
        w: T.number,
        h: T.number,
        pageId: T.string,
        pageTitle: T.string,
    };

    override getDefaultProps(): PageCardShape['props'] {
        return { w: 260, h: 170, pageId: '', pageTitle: '' };
    }

    override canResize = () => true;
    override canEdit = () => false;

    override getGeometry(shape: PageCardShape): Rectangle2d {
        return new Rectangle2d({
            width: shape.props.w,
            height: shape.props.h,
            isFilled: true,
        });
    }

    override component(shape: PageCardShape) {
        return createElement(PageCardComponent, { shape });
    }

    override indicator(shape: PageCardShape) {
        return createElement('rect', { width: shape.props.w, height: shape.props.h, rx: 10 });
    }

    override onResize = (shape: PageCardShape, info: TLResizeInfo<PageCardShape>) => resizeBox(shape, info);
}
