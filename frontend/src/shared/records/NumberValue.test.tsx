import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NumberValue } from './NumberValue';
import { resolveFieldFormat } from './model/formatUtils';

const render = (value: unknown, display?: string) => renderToStaticMarkup(<NumberValue value={value} format={resolveFieldFormat({ format: { kind: 'percent', display } }, { numberLocale: 'en-US' })} />);
describe('shared progress presentation', () => {
    it('shows zero as progress and keeps empty and invalid values empty', () => {
        expect(render(0)).toContain('aria-valuenow="0"');
        expect(render(0)).toContain('0%');
        expect(render('50%')).toContain('aria-valuenow="50"');
        for (const value of [null, undefined, '', NaN]) expect(render(value)).not.toContain('role="progressbar"');
    });
    it('shows rings and preserves out-of-range values while bounding the drawing', () => {
        expect(render(42, 'ring')).toContain('stroke-dasharray="42 100"');
        expect(render(130)).toContain('aria-valuenow="100"');
        expect(render(130)).toContain('130%');
        expect(render(-10)).toContain('aria-valuenow="0"');
        expect(render('12,5')).toContain('12.5%');
    });
    it('supports fractional progress without changing its stored scale', () => {
        const format = resolveFieldFormat({ format: { display: 'bar', progressMax: 1 } });
        const html = renderToStaticMarkup(<NumberValue value={0.5} format={format} />);
        expect(html).toContain('aria-valuenow="50"');
        expect(html).toContain('50%');
    });
    it('honors plain numbers and defaults percentage rollups to bars', () => {
        expect(render(42, 'number')).not.toContain('progressbar');
        expect(resolveFieldFormat({ aggregation: 'percent_checked' })).toMatchObject({ kind: 'percent', display: 'bar' });
        expect(resolveFieldFormat({})).toMatchObject({ kind: 'number', display: 'number' });
    });
});
