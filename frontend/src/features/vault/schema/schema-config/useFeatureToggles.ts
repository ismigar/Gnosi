import type { SchemaState } from './useSchemaState';
import type { ResolvedProps } from './props';
import { useTranslation } from 'react-i18next';
import { OPTION_FIELD_TYPES, TRANSLATABLE_FIELD_TYPES } from './constants';
import { STATUS_CATALOG_REF, normalizeOptions, seedOptionsForFeature, type NormalizedOption } from '../../../../shared/records/model/optionCatalogUtils';
import { generateFieldId } from './field-id';
import type { Field, OptionTools, ToggleConfirmation } from './types';
export function useFeatureToggles(state: SchemaState, _props: ResolvedProps, optionTools: OptionTools) {
    const { t } = useTranslation();
    const {
        fields, setFields, enableSubitems, setEnableSubitems, enableTranslation, setEnableTranslation,
        sharedCatalogs, enableDrupalSync, setEnableDrupalSync, drupalFieldMapping, enableSocialPublish,
        setEnableSocialPublish, setToggleConfirm,
    } = state;
    const closeToggleConfirm = () => { setToggleConfirm((s) => ({ ...s, isOpen: false })); };
    const requestDisableConfirm = ({ title, message, confirmText, onConfirm }: Omit<ToggleConfirmation, "isOpen">) => {
        setToggleConfirm({ isOpen: true, title, message, confirmText, onConfirm });
    };
    const seedStatusOptions = (feature: string) => {
        const sharedUpdate: { options: NormalizedOption[] | null } = { options: null };
        setFields((prev) => {
            const isStatusField = (f: Field) =>
                OPTION_FIELD_TYPES.has(f.type) && f.type !== 'multi_select' && (
                    f.rawConfig?.role === 'status' ||
                    ['estat', 'estado', 'status', 'state'].includes((f.name || '').trim().toLowerCase())
                );
            const idx = prev.findIndex(isStatusField);
            if (idx === -1) return prev;
            const f = prev[idx];
            if (!f) return prev;
            if (f.catalogRef) {
                if (f.catalogRef === STATUS_CATALOG_REF) {
                    const current = normalizeOptions(sharedCatalogs[STATUS_CATALOG_REF] || f.options);
                    const have = new Set(current.map((o) => o.name));
                    const additions = [...seedOptionsForFeature('base'), ...seedOptionsForFeature(feature)]
                        .filter((o) => !have.has(o.name));
                    if (additions.length > 0) sharedUpdate.options = [...current, ...additions];
                }
                return prev;
            }
            const current = normalizeOptions(f.options);
            const have = new Set(current.map((o) => o.name));
            const additions = [...seedOptionsForFeature('base'), ...seedOptionsForFeature(feature)]
                .filter((o) => !have.has(o.name));
            if (additions.length === 0) return prev;
            const next = [...prev];
            next[idx] = { ...f, options: [...current, ...additions] };
            return next;
        });
        if (sharedUpdate.options) void optionTools.updateSharedCatalog?.(STATUS_CATALOG_REF, sharedUpdate.options);
    };

    const handleToggleTranslation = (next: boolean) => {
        if (!next && enableTranslation && fields.some((f) => f.translatable)) {
            requestDisableConfirm({
                title: t('schema.translation_disable_title', "Disable translation"),
                message: t('schema.translation_disable_confirm', "Disable translation for this table? Existing translations are kept, but the table will no longer be translatable."),
                confirmText: t('schema.disable', "Disable"),
                onConfirm: () => { setEnableTranslation(false); },
            });
            return;
        }
        setEnableTranslation(next);
        if (next && !enableSubitems) {
            setEnableSubitems(true);
        }
        if (next) {
            seedStatusOptions('translation');
            // A translatable table with no translatable field fails silent
            // validation, which blocks autosave for the WHOLE modal: the toggle
            // (and every later change) was discarded on close. We seed a sensible
            // default — the title, which translate_row needs anyway — so the state
            // is valid the moment the toggle flips. The user can change it after.
            ensureTranslatableField();
        }
    };

    // Marks a default translatable field when there is none. Prefers the title
    // (the backend uses its translation as the subitem's title); otherwise, the
    // first non-system field whose type supports translation.
    const ensureTranslatableField = () => {
        setFields((prev) => {
            if (prev.some((f) => f.translatable && TRANSLATABLE_FIELD_TYPES.has(f.type))) return prev;
            let idx = prev.findIndex((f) => f.type === 'title');
            if (idx === -1) {
                idx = prev.findIndex((f) => !f.system && TRANSLATABLE_FIELD_TYPES.has(f.type));
            }
            if (idx === -1) return prev;
            const next = [...prev];
            const field = next[idx];
            if (!field) return prev;
            next[idx] = { ...field, translatable: true };
            return next;
        });
    };

    // --- Drupal synchronization -----------------------------------------
    // Names of the system-managed columns where the sync stores the NID and
    // the Drupal node's URL. Read-only in the grid (config.system). They are
    // VALUES stored in the schema (the sync looks them up by name) — never via i18n.
    const DRUPAL_NID_COL = 'Drupal NID';
    const DRUPAL_URL_COL = 'Drupal URL';

    // Adds the two output columns (NID/URL) if they aren't there yet. They
    // are managed as part of the schema (like the translate button): this way
    // they're persisted via buildPayload and continuous autosave doesn't erase them.
    const addDrupalColumns = () => {
        const mk = (name: string, type: string): Field => ({
            id: generateFieldId(), name, type,
            formula: '', compute: '', defaultFormula: '', relationField: '',
            targetProperty: '', aggregation: 'count_values', limit: '', fallbackValue: '',
            relation_database_id: '', cardinality: 'one-to-many', file_mode: 'upload',
            storage_folder: '', name_pattern: '', translatable: false, system: true,
            button_action: '', button_label: '', options: [], format: {}, visible: true,
        });
        setFields((prev) => {
            const have = new Set(prev.map((f) => (f.name || '').trim().toLowerCase()));
            const additions = [];
            if (!have.has(DRUPAL_NID_COL.toLowerCase())) additions.push(mk(DRUPAL_NID_COL, 'text'));
            if (!have.has(DRUPAL_URL_COL.toLowerCase())) additions.push(mk(DRUPAL_URL_COL, 'url'));
            return additions.length ? [...prev, ...additions] : prev;
        });
    };

    const handleToggleDrupalSync = (next: boolean) => {
        // When disabling, asks for confirmation (centered modal) if there is a mapping
        // configured: this way an accidental click (with autosave active) doesn't leave the
        // table unsynced without warning. The mapping is preserved on the backend.
        if (!next && enableDrupalSync && Object.keys(drupalFieldMapping).length > 0) {
            requestDisableConfirm({
                title: t('schema.drupal_sync_disable_title', "Disable Drupal sync"),
                message: t('schema.drupal_sync_disable_confirm', "Disable Drupal sync? The field mapping will be kept in case you enable it again."),
                confirmText: t('schema.disable', "Disable"),
                onConfirm: () => { setEnableDrupalSync(false); },
            });
            return;
        }
        setEnableDrupalSync(next);
        if (next) {
            addDrupalColumns();
            seedStatusOptions('drupal');
        }
    };

    // `system` column that marks the table as publishable to XXSS. Its
    // presence is the signal that makes the "Publish to XXSS" button appear (like the
    // Drupal columns). It is persisted with the schema via the `fields` autosave:
    // it's a saved/compared VALUE for logic, not a label — never via i18n
    // (translating it would break detection in tables created in another language).
    const SOCIAL_PUBLISH_COL = 'XXSS';
    const addSocialPublishColumns = () => {
        setFields((prev) => {
            const have = new Set(prev.map((f) => (f.name || '').trim().toLowerCase()));
            if (have.has(SOCIAL_PUBLISH_COL.toLowerCase())) return prev;
            return [...prev, {
                id: generateFieldId(), name: SOCIAL_PUBLISH_COL, type: 'text',
                formula: '', compute: '', defaultFormula: '', relationField: '',
                targetProperty: '', aggregation: 'count_values', limit: '', fallbackValue: '',
                relation_database_id: '', cardinality: 'one-to-many', file_mode: 'upload',
                storage_folder: '', name_pattern: '', translatable: false, system: true,
                button_action: '', button_label: '', options: [], format: {}, visible: true,
            }];
        });
    };

    // Removes the `system` column of XXSS from the schema. Same criterion for
    // detection than the initial state (system + xxss/social name), because in
    // reopening the modal the toggle doesn't get re-derived as active.
    const removeSocialPublishColumns = () => {
        setFields((prev) => prev.filter((f) => !(f.system && /xxss|social/i.test(f.name || ''))));
    };

    const handleToggleSocialPublish = (next: boolean) => {
        if (!next && enableSocialPublish) {
            requestDisableConfirm({
                title: t('schema.social_disable_title', "Disable social publishing"),
                message: t('schema.social_publish_disable_confirm', { col: SOCIAL_PUBLISH_COL, defaultValue: "Disable social publishing? The “{{col}}” column will be removed from the schema and the table will no longer be publishable to social networks." }),
                confirmText: t('schema.disable', "Disable"),
                onConfirm: () => { setEnableSocialPublish(false); removeSocialPublishColumns(); },
            });
            return;
        }
        setEnableSocialPublish(next);
        if (next) {
            addSocialPublishColumns();
            seedStatusOptions('social');
        }
    };

    return { closeToggleConfirm, handleToggleTranslation, handleToggleDrupalSync, handleToggleSocialPublish };
}
