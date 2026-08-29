import { createElement } from 'react';
import {
    BaseBoxShapeUtil,
    Rectangle2d,
    resizeBox,
    T,
    type RecordProps,
    type TLResizeInfo,
} from 'tldraw';

import { PageCardComponent } from './canvas-page-card/PageCardComponent';
import {
    PAGE_CARD_TYPE,
    type PageCardShape,
} from './canvas-page-card/types';


export { CanvasPageContext } from './canvas-page-card/context';
export type { PageCardShape } from './canvas-page-card/types';


export class PageCardShapeUtil extends BaseBoxShapeUtil<PageCardShape> {
    static override type = PAGE_CARD_TYPE;
    static override props: RecordProps<PageCardShape> = {
        w: T.number,
        h: T.number,
        pageId: T.string,
        pageTitle: T.string,
    };

    override getDefaultProps(): PageCardShape['props'] {
        return { w: 260, h: 170, pageId: '', pageTitle: '' };
    }

    override canResize(): boolean { return true; }
    override canEdit(): boolean { return false; }

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

    override getIndicatorPath(shape: PageCardShape): Path2D {
        const path = new Path2D();
        path.roundRect(0, 0, shape.props.w, shape.props.h, 10);
        return path;
    }

    override onResize(shape: PageCardShape, info: TLResizeInfo<PageCardShape>) {
        return resizeBox(shape, info);
    }
}
