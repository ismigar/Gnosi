import '@bigbluebutton/tldraw';

declare module '@bigbluebutton/tldraw' {
    // The fork exports this runtime limit but omits it from its generated declarations.
    export const MAX_SHAPES_PER_PAGE: number;
}
