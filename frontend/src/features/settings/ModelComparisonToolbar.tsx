import { useEffect, useRef, type Dispatch, type RefObject } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GnosiToggle } from '../../shared/ui/settings/SettingsPrimitives';
import { ComparisonLabel } from './ComparisonLabel';

import {
    COMPARISON_MODE_KEYS,
    COMPARISON_PROFILE_KEYS,
    PROFILE_ICONS,
    formatTokenCountInput,
    type ComparisonAvailability,
    type ComparisonProfile,
    type MetricAvailability,
    type ParameterStatusFilter,
    type ModelComparisonUiAction,
    type ModelComparisonUiState,
} from './modelComparison';


interface ModelComparisonToolbarProps {
    readonly providers: readonly { id: string; name: string }[];
    readonly currencySymbol: string;
    readonly dispatch: Dispatch<ModelComparisonUiAction>;
    readonly metricAvailability: MetricAvailability;
    readonly profileHelpRef: RefObject<HTMLElement | null>;
    readonly state: ModelComparisonUiState;
    readonly toolbarRef: RefObject<HTMLDivElement | null>;
}


export function ModelComparisonToolbar({
    providers,
    currencySymbol,
    dispatch,
    metricAvailability,
    profileHelpRef,
    state,
    toolbarRef,
}: ModelComparisonToolbarProps) {
    const { t } = useTranslation();
    const modesFilterRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!state.modesMenuOpen) return;
        const closeOutside = (event: PointerEvent) => {
            if (event.target instanceof Node && !modesFilterRef.current?.contains(event.target)) {
                dispatch({ type: 'close-modes-menu' });
            }
        };
        document.addEventListener('pointerdown', closeOutside, true);
        return () => { document.removeEventListener('pointerdown', closeOutside, true); };
    }, [dispatch, state.modesMenuOpen]);

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
                <label>
                    <span>{t('settings.ai.provider')}</span>
                    <select value={state.provider} onChange={(event) => {
                        dispatch({ type: 'set-provider', value: event.target.value });
                    }}>
                        <option value="all">{t('model_comparison.all_providers')}</option>
                        {providers.map((provider) => (
                            <option key={provider.id} value={provider.id}>{provider.name}</option>
                        ))}
                    </select>
                </label>
                {metricAvailability.profile ? (
                    <label className="model-profile-filter">
                        <span>
                            <ComparisonLabel text={t('model_comparison.compact_filters.profile')} full={t('model_comparison.profile')} />
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
                    <ComparisonLabel text={t('model_comparison.compact_filters.availability')} full={t('model_comparison.availability')} />
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
                <div className="model-modes-filter" ref={modesFilterRef}>
                    <ComparisonLabel text={t('model_comparison.compact_filters.modes')} full={t('model_comparison.modes')} />
                    <button
                        aria-expanded={state.modesMenuOpen}
                        aria-haspopup="dialog"
                        onClick={() => {
                            dispatch({ type: 'toggle-modes-menu' });
                        }}
                        type="button"
                    >
                        <span>
                            {state.modes.length > 0
                                ? state.modes.map((mode) => t(
                                    `model_comparison.modes_list.${mode}`,
                                )).join(state.modeMatch === 'all' ? ' + ' : ' / ')
                                : t('model_comparison.all_modes')}
                        </span>
                        <ChevronDown size={16} />
                    </button>
                    {state.modesMenuOpen ? (
                        <div className="model-modes-menu" role="dialog" aria-label={t('model_comparison.modes')}>
                            <select aria-label={t('model_comparison.mode_match')}
                                value={state.modeMatch} onChange={(event) => {
                                    dispatch({ type: 'set-mode-match', value: event.target.value as 'all' | 'any' });
                                }}>
                                <option value="all">{t('model_comparison.mode_match_all')}</option>
                                <option value="any">{t('model_comparison.mode_match_any')}</option>
                            </select>
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
                    <ComparisonLabel text={t('model_comparison.compact_filters.max_price', { symbol: currencySymbol })} full={t('model_comparison.max_price', { symbol: currencySymbol })} />
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
                    <ComparisonLabel text={t('model_comparison.compact_filters.min_context')} full={t('model_comparison.min_context')} />
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
                <div className="model-show-incomplete-toggle">
                    <GnosiToggle
                        active={state.showIncomplete}
                        label={t('model_comparison.show_incomplete')}
                        onChange={() => {
                            dispatch({
                                type: 'set-show-incomplete',
                                value: !state.showIncomplete,
                            });
                        }}
                    />
                    <ComparisonLabel text={t('model_comparison.compact_filters.show_incomplete')} full={t('model_comparison.show_incomplete')} />
                </div>
                <div className="model-parameter-filters" role="group" aria-label={t('model_comparison.columns.parameters')}>
                    <label>
                        <ComparisonLabel text={t('model_comparison.compact_filters.parameter_status')} full={t('model_comparison.parameter_status')} />
                        <select value={state.parameterStatus} onChange={(event) => {
                            dispatch({ type: 'set-parameter-status', value: event.target.value as ParameterStatusFilter });
                        }}>
                            <option value="all">{t('model_comparison.parameters_all')}</option>
                            <option value="known">{t('model_comparison.parameters_known')}</option>
                            <option value="not_published">{t('model_comparison.parameters_not_published')}</option>
                            <option value="pending">{t('model_comparison.parameters_missing')}</option>
                        </select>
                    </label>
                    <label>
                        <ComparisonLabel text={t('model_comparison.compact_filters.min_parameters')} full={t('model_comparison.min_parameters')} />
                        <input min="0" step="any" type="number" value={state.minParameters}
                            onChange={(event) => { dispatch({ type: 'set-min-parameters', value: event.target.value }); }} />
                    </label>
                    <label>
                        <ComparisonLabel text={t('model_comparison.compact_filters.max_parameters')} full={t('model_comparison.max_parameters')} />
                        <input min="0" step="any" type="number" value={state.maxParameters}
                            onChange={(event) => { dispatch({ type: 'set-max-parameters', value: event.target.value }); }} />
                    </label>
                    <small>{t('model_comparison.parameters_filter_help')}</small>
                </div>
            </div>

            {state.profile !== 'all' && state.profile !== 'unrated' && <div className="model-comparison-note">
                <p>{t('model_comparison.choice_help')}</p>
                <button className="btn-gnosi-secondary" type="button" onClick={() => { dispatch({ type: 'compare-role-candidates' }); }}>{t('model_comparison.compare_candidates')}</button>
            </div>}

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
                    <ComparisonLabel text={t('model_comparison.compact_filters.input_tokens')} full={t('model_comparison.input_tokens')} />
                    <input
                        inputMode="numeric"
                        onChange={(event) => {
                            dispatch({
                                type: 'set-input-tokens',
                                value: event.target.value,
                            });
                        }}
                        type="text"
                        value={formatTokenCountInput(state.inputTokens)}
                    />
                </label>
                <label>
                    <ComparisonLabel text={t('model_comparison.compact_filters.output_tokens')} full={t('model_comparison.output_tokens')} />
                    <input
                        inputMode="numeric"
                        onChange={(event) => {
                            dispatch({
                                type: 'set-output-tokens',
                                value: event.target.value,
                            });
                        }}
                        type="text"
                        value={formatTokenCountInput(state.outputTokens)}
                    />
                </label>
            </div>
        </>
    );
}
