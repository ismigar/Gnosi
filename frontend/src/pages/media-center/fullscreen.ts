// Fullscreen is optional in embedded browsers and DOM test environments.
type FullscreenDocument = Partial<Pick<Document, 'exitFullscreen'>>;
type FullscreenElement = Partial<Pick<HTMLElement, 'requestFullscreen'>>;

export function exitMediaFullscreen(target: FullscreenDocument = document): void {
    void target.exitFullscreen?.().catch(() => {});
}
export function enterMediaFullscreen(target: FullscreenElement): void {
    void target.requestFullscreen?.().catch(() => {});
}
