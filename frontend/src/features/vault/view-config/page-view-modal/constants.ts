import { Eye, Filter, ArrowUpDown, SlidersHorizontal, Layers } from 'lucide-react';
export const FILTER_OPERATORS = [
    { value: 'equals', label: 'equals' },
    { value: 'not_equals', label: 'does not equal' },
    { value: 'contains', label: 'contains' },
    { value: 'not_contains', label: 'does not contain' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
    { value: 'greater_than', label: 'greater than' },
    { value: 'greater_than_or_equal', label: 'greater than or equal' },
    { value: 'less_than', label: 'less than' },
    { value: 'less_than_or_equal', label: 'less than or equal' },
];
export const CARD_SIZES = [
    { value: 'small', label: 'Small' },
    { value: 'medium', label: 'Medium' },
    { value: 'large', label: 'Large' },
];
export const GALLERY_PREVIEWS = [
    { value: 'cover', label: 'Cover', hint: 'Page cover image and properties.' },
    { value: 'content', label: 'Content', hint: 'A snippet of page text and its properties.' },
    { value: 'properties', label: 'Properties only', hint: 'No image; title and properties.' },
    { value: 'none', label: 'Title only', hint: 'Minimal card with cover and title, without properties.' },
];
export const GROUP_FIELD_TYPES = new Set(['select', 'status', 'multi_select']);
export const DATE_FIELD_TYPES = new Set(['date', 'datetime', 'period']);
export const NUMERIC_FIELD_TYPES = new Set(['number', 'formula', 'rollup', 'currency', 'percent']);
export const TABS = [
    { id: 'general', icon: SlidersHorizontal, label: 'General' },
    { id: 'properties', icon: Eye, label: 'Fields' },
    { id: 'filters', icon: Filter, label: 'Filters' },
    { id: 'sort', icon: ArrowUpDown, label: 'Sort' },
    { id: 'grouping', icon: Layers, label: 'Grouping' },
];
export const MAX_FILTER_DEPTH = 3;
export const NO_VALUE_OPS = ['is_empty', 'is_not_empty'];
