import { describe, expect, it } from 'vitest';

import { getViewPopoverLayout } from './viewPopoverLayout';

describe('getViewPopoverLayout', () => {
  it('anchors below the add button when enough room is available', () => {
    expect(
      getViewPopoverLayout(
        { left: 600, top: 100, bottom: 124 },
        1280,
        800,
      ),
    ).toEqual({
      left: 600,
      width: 400,
      maxHeight: 620,
      top: 130,
    });
  });

  it('flips above the add button and remains inside the viewport', () => {
    expect(
      getViewPopoverLayout(
        { left: 900, top: 680, bottom: 704 },
        1280,
        720,
      ),
    ).toEqual({
      left: 872,
      width: 400,
      maxHeight: 620,
      bottom: 46,
    });
  });

  it('clamps its width and horizontal position on a narrow viewport', () => {
    expect(
      getViewPopoverLayout(
        { left: 350, top: 100, bottom: 144 },
        390,
        844,
      ),
    ).toEqual({
      left: 8,
      width: 374,
      maxHeight: 620,
      top: 150,
    });
  });
});
