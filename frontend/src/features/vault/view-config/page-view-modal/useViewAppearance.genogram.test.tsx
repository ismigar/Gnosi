import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { configValue, PEOPLE_TABLE_ID } from '../../../genograms';
import { useViewState } from './useViewState';
import { useViewAppearance } from './useViewAppearance';
import { useViewSnapshot } from './useViewSnapshot';

function useModel() {
  const state = useViewState({ preselectedTableId: PEOPLE_TABLE_ID });
  return { state, ...useViewAppearance(state), ...useViewSnapshot(state) };
}

describe('genogram view configuration', () => {
  it('retains focus and manual layout when copying a saved view into a note', () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const config = configValue({ root_id: 'person-a', exclude_ids: ['person-b'], positions: { 'person-a': { x: 30, y: 70 } }, emotional: false });
    const probe = vi.fn<(model: ReturnType<typeof useModel>) => void>();
    function Harness() { probe(useModel()); return null; }
    const current = () => { const value = probe.mock.lastCall?.[0]; if (!value) throw new Error('Harness not mounted'); return value; };
    const root = createRoot(document.createElement('div'));
    try {
      act(() => { root.render(<Harness />); });
      act(() => { current().state.setViewType('genogram'); current().applyTypeOptions({ genogram: config }); });
      expect(current().buildViewExtras()).toEqual({ genogram: config });
      expect(current().formSnapshot).toContain('person-a');
      act(() => { current().resetTypeOptions(); });
      expect(current().buildViewExtras({ genogram: config })).toEqual({ genogram: config });
      expect(current().state.genogram.root_id).toBe('');
    } finally { act(() => { root.unmount(); }); }
  });
});
