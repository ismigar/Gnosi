import {act} from 'react';
import {createInstance} from 'i18next';
import {expect,it,vi} from 'vitest';
import {mountTestComponent} from '../../../../../tests/mount-react';
import {TableHeader} from './TableHeader';
import {TableFooter} from './TableFooter';
import {RowActions} from './RowActions';
import type {TableController} from './useTableController';
import ca from '../../../../shared/i18n/locales/ca/translation.json';
import en from '../../../../shared/i18n/locales/en/translation.json';
import es from '../../../../shared/i18n/locales/es/translation.json';
import fr from '../../../../shared/i18n/locales/fr/translation.json';

it.each(['ca','en','es','fr'])('names selection and column aggregation in %s, preserving actions',async lang=>{
 const i18n=createInstance();await i18n.init({lng:lang,resources:{ca:{translation:ca},en:{translation:en},es:{translation:es},fr:{translation:fr}},interpolation:{escapeValue:false}});
 const selectAll=vi.fn(),toggleSelect=vi.fn(),setAggregations=vi.fn();
 const model={t:i18n.t,selectedIds:new Set(['a']),sortedNotes:[{id:'a'},{id:'b'}],selectAll,clearSelection:vi.fn(),schema:{},openHeaderHelp:{},columnWidths:{},activeSort:{field:'title',direction:'asc'},dynamicColumns:[['Score','number']],showModifiedColumn:true,aggregations:{},setAggregations,calculateAggregation:()=>'',isSelected:()=>false,toggleSelect,tableFunctionalities:[],hasOpenableResource:()=>false,onNoteSelect:vi.fn()} as unknown as TableController;
 const view=mountTestComponent(<table><TableHeader model={{...model,dynamicColumns:[]}}/><tbody><tr className="group/row"><RowActions model={model} note={{id:'a',title:'Alpha'}} isChild={false}/></tr></tbody><TableFooter model={model}/></table>);
 const boxes=view.container.querySelectorAll('input');const all=boxes[0],row=boxes[1];if(!all||!row)throw new Error('Missing selection controls');
 expect(all.getAttribute('aria-label')).toBe(i18n.t('table.select_all_rows'));expect(all.getAttribute('aria-label')).not.toBe('table.select_all_rows');expect(all.indeterminate).toBe(true);
 expect(row.getAttribute('aria-label')).toBe(i18n.t('table.select_row',{title:'Alpha'}));
 act(()=>{all.click();row.click();});expect(selectAll).toHaveBeenCalledWith(['a','b']);expect(toggleSelect).toHaveBeenCalledWith('a',{shiftKey:false});
 const selects=Array.from(view.container.querySelectorAll('select'));expect(selects.map(s=>s.getAttribute('aria-label'))).toEqual([i18n.t('table.aggregate_column',{column:i18n.t('table.note_name')}),i18n.t('table.aggregate_column',{column:'Score'}),i18n.t('table.aggregate_column',{column:i18n.t('table.modified_column')})]);
 const score=selects[1];if(!score)throw new Error('Missing Score aggregation');act(()=>{score.value='sum';score.dispatchEvent(new Event('change',{bubbles:true}));});expect(setAggregations).toHaveBeenCalledWith({Score:'sum'});
});
