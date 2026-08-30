import type { Dispatch, RefObject } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    COMPARISON_MODE_KEYS,
    COMPARISON_PROFILE_KEYS,
    PROFILE_ICONS,
    type ComparisonAvailability,
    type ComparisonProfile,
    type MetricAvailability,
    type ModelComparisonUiAction,
    type ModelComparisonUiState,
} from './modelComparison';


interface ModelComparisonToolbarProps {
    readonly dispatch: Dispatch<ModelComparisonUiAction>;
    readonly metricAvailability: MetricAvailability;
    readonly profileHelpRef: RefObject<HTMLElement | null>;
    readonly state: ModelComparisonUiState;
    readonly toolbarRef: RefObject<HTMLDivElement | null>;
}


export function ModelComparisonToolbar({
    dispatch,
    metricAvailability,
    profileHelpRef,
    state,
    toolbarRef,
}: ModelComparisonToolbarProps) {
    const { t } = useTranslation();

    return (
        <>
            <div className="model-comparison-toolbar" ref={toolbarRef}>
                <label className="model-search">
                    <Search size={18} />
                    <input
                        onChange={(event) => {
                            dispatch({ type: 'set-query', value: event.target.value });
                        }}
                        placeholder={t('model_comparison.search')}
                        value={state.query}
                    />
                </label>
                {metricAvailability.profile ? (
                    <label className="model-profile-filter">
                        <span>
                            {t('model_comparison.profile')}
                            {' '}
                            <button
                                aria-label={t('model_comparison.profile_help_open')}
                                className="model-profile-help"
                                onClick={() => {
                                    dispatch({
                                        type: 'set-show-profile-help',
                                        value: true,
                                    });
                                }}
                                type="button"
                            >
                                ?
                            </button>
                        </span>
                        <select
                            onChange={(event) => {
                                dispatch({
                                    type: 'set-profile',
                                    value: event.target.value as 'all' | ComparisonProfile,
                                });
                            }}
                            value={state.profile}
                        >
                            <option value="all">
                                {t('model_comparison.all_profiles')}
                            </option>
                            {COMPARISON_PROFILE_KEYS.map((profile) => (
                                <option key={profile} value={profile}>
                                    {t(`model_comparison.profiles.${profile}`)}
                                </option>
                            ))}
                        </select>
                    </label>
                ) : null}
                <label>
                    <span>{t('model_comparison.availability')}</span>
                    <select
                        onChange={(event) => {
                            dispatch({
                                type: 'set-availability',
                                value: event.target.value as ComparisonAvailability,
                            });
                        }}
                        value={state.availability}
                    >
                        <option value="all">{t('model_comparison.all_availability')}</option>
                        <option value="active">{t('model_comparison.active')}</option>
                        <option value="inactive">{t('model_comparison.inactive')}</option>
                    </select>
                </label>
                <div className="model-modes-filter">
                    <span>{t('model_comparison.modes')}</span>
                    <button
                        aria-expanded={state.modesMenuOpen}
                        aria-haspopup="menu"
                        onClick={() => {
                            dispatch({ type: 'toggle-modes-menu' });
                        }}
                        type="button"
                    >
                        <span>
                            {state.modes.length > 0
                                ? state.modes.map((mode) => t(
                                    `model_comparison.modes_list.${mode}`,
                                )).join(', ')
                                : t('model_comparison.all_modes')}
                        </span>
                        <ChevronDown size={16} />
                    </button>
                    {state.modesMenuOpen ? (
                        <div className="model-modes-menu" role="menu">
                            {COMPARISON_MODE_KEYS.map((mode) => (
                                <label key={mode}>
                                    <input
                                        checked={state.modes.includes(mode)}
                                        onChange={() => {
                                            dispatch({ mode, type: 'toggle-mode' });
                                        }}
                                        type="checkbox"
                                    />
                                    {t(`model_comparison.modes_list.${mode}`)}
                                </label>
                            ))}
                        </div>
                    ) : null}
                </div>
                <label>
                    <span>{t('model_comparison.max_price')}</span>
                    <input
                        min="0"
                        onChange={(event) => {
                            dispatch({
                                type: 'set-max-price',
                                value: event.target.value,
                            });
                        }}
                        placeholder="1.00"
                        step="0.01"
                        type="number"
                        value={state.maxPrice}
                    />
                </label>
                <label>
                    <span>{t('model_comparison.min_context')}</span>
                    <input
                        min="0"
                        onChange={(event) => {
                            dispatch({
                                type: 'set-min-context',
                                value: event.target.value,
                            });
                        }}
                        placeholder="100"
                        type="number"
                        value={state.minContext}
                    />
                </label>
                <label className="model-show-incomplete-toggle">
                    <input
                        checked={state.showIncomplete}
                        onChange={(event) => {
                            dispatch({
                                type: 'set-show-incomplete',
                                value: event.target.checked,
                            });
                        }}
                        type="checkbox"
                    />
                    <span>{t('model_comparison.show_incomplete')}</span>
                </label>
            </div>

            {state.showProfileHelp ? (
                <div className="model-profile-help-backdrop" role="presentation">
                    <section
                        aria-labelledby="model-profile-help-title"
                        aria-modal="true"
                        className="model-profile-help-dialog"
                        ref={profileHelpRef}
                        role="dialog"
                    >
                        <header>
                            <div>
                                <h2 id="model-profile-help-title">
                                    {t('model_comparison.profile_help_title')}
                                </h2>
                                <p>{t('model_comparison.profile_help_intro')}</p>
                            </div>
                            <button
                                aria-label={t('model_comparison.close')}
                                data-autofocus
                                onClick={() => {
                                    dispatch({
                                        type: 'set-show-profile-help',
                                        value: false,
                                    });
                                }}
                                type="button"
                            >
                                <X size={20} />
                            </button>
                        </header>
                        <div className="model-profile-help-content">
                            {COMPARISON_PROFILE_KEYS.map((profile) => (
                                <article key={profile}>
                                    <h3>
                                        {PROFILE_ICONS[profile]}
                                        {' '}
                                        {t(`model_comparison.profiles.${profile}`)}
                                    </h3>
                                    <p><strong>{t(
                                        `model_comparison.profile_help.${profile}.objective`,
                                    )}</strong></p>
                                    <p>{t(
                                        `model_comparison.profile_help.${profile}.examples`,
                                    )}</p>
                                </article>
                            ))}
                            <article>
                                <h3>{t('model_comparison.profile_help_flow_title')}</h3>
                                <p>{t('model_comparison.profile_help_flow')}</p>
                            </article>
                        </div>
                    </section>
                </div>
            ) : null}

            <div className="model-cost-calculator">
                <label>
                    <span>{t('model_comparison.input_tokens')}</span>
                    <input
                        min="0"
                        onChange={(event) => {
                            dispatch({
                                type: 'set-input-tokens',
                                value: event.target.value,
                            });
                        }}
                        type="number"
                        value={state.inputTokens}
                    />
                </label>
                <label>
                    <span>{t('model_comparison.output_tokens')}</span>
                    <input
                        min="0"
                        onChange={(event) => {
                            dispatch({
                                type: 'set-output-tokens',
                                value: event.target.value,
                            });
                        }}
                        type="number"
                        value={state.outputTokens}
                    />
                </label>
            </div>
        </>
    );
}
