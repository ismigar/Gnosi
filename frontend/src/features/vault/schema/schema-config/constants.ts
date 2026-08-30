export const ROLLUP_AGGREGATIONS = [
    { value: 'count_all', label: 'Count all' },
    { value: 'count_values', label: 'Count values' },
    { value: 'sum', label: 'Sum' },
    { value: 'avg', label: 'Avg' },
    { value: 'min', label: 'Min' },
    { value: 'max', label: 'Max' },
    { value: 'unique_count', label: 'Unique count' },
    { value: 'percent_checked', label: '% checked' },
    { value: 'earliest', label: 'Earliest' },
    { value: 'latest', label: 'Latest' },
    { value: 'show_original', label: 'Show original' },
];

// Field types that can be marked as translatable. Excludes derived fields
// (formula/rollup/virtual), fields without textual content, and type
// structural fields such as `button`. `title` is indeed allowed: the backend
// (translate_row) uses the title translation as the subitem's title.
export const TRANSLATABLE_FIELD_TYPES = new Set([
    'title', 'text', 'rich_text', 'select', 'multi_select', 'status', 'url'
]);

// Catalog of row actions available as table-level functionalities.
export const FUNCTIONALITY_ACTIONS = [
    { id: 'translate_row', label_key: 'schema.button_action_translate_row', label_default: 'Traduir fila a subitems' },
    { id: 'set_fields', label_key: 'schema.button_action_set_fields', label_default: 'Assignar valors a camps' },
    { id: 'ai_prompt', label_key: 'schema.button_action_ai_prompt', label_default: 'Executar prompt IA' },
    { id: 'run_skill', label_key: 'schema.button_action_run_skill', label_default: 'Executar Skill de Settings' },
];

// Field types that have a fixed catalog of selectable options.
export const OPTION_FIELD_TYPES = new Set(['select', 'multi_select', 'status']);
export const RULE_PROTECTED_OPTIONS = new Set([
    'Esborrany', 'Traduït', 'Publicat a Drupal', 'Publicat a XXSS',
]);
export const ASSIGNMENT_NUMERIC_TYPES = ['number', 'currency', 'percent', 'formula', 'rollup'];
export const ASSIGNMENT_DATE_TYPES = ['date', 'period'];
export const ASSIGNMENT_DATETIME_TYPES = ['datetime'];
