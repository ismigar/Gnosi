import type { Page } from '@playwright/test';

/** Inspect the rendered state after finite layout/color transitions finish. */
export async function settleVisualState(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await Promise.all(document.getAnimations()
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => undefined)));
  });
}


/** Explicitly open the requested Webs editor before interacting with folded controls. */
export async function expandWebsiteSections(page: Page): Promise<void> {
  for (let depth = 0; depth < 16; depth += 1) {
    let expanded = false;
    for (const summary of await page.locator('.websites-page details:not([open]) > summary').elementHandles()) {
      if (await summary.isVisible()) { await summary.click(); expanded = true; }
    }
    if (!expanded) return;
  }
  throw new Error('Website section nesting did not settle');
}
