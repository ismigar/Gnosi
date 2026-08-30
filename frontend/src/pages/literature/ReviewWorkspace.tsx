import {
  Archive,
  BookOpenCheck,
  Bot,
  CircleAlert,
  Download,
  Plus,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';

import { authorLine } from './literatureModel';
import { CandidateCard } from './CandidateCard';
import type {
  LiteratureSearchView,
  LiteratureWorkView,
  ReviewMode,
  SnowballDirection,
  Translate,
} from './literatureTypes';
import {
  useLiteratureReview,
  type LiteratureReviewController,
} from './useLiteratureReview';

interface ReviewWorkspaceProps {
  readonly currentSearch: LiteratureSearchView | null;
  readonly selectedWorks: readonly LiteratureWorkView[];
  readonly t: Translate;
}

interface ReviewSidebarProps {
  readonly controller: LiteratureReviewController;
  readonly t: Translate;
}

function ReviewSidebar({ controller, t }: ReviewSidebarProps) {
  const { actions, setters, state } = controller;
  return (
    <aside className="literature-review-list">
      <h2>{t('literature.review.title')}</h2>
      <label>
        <span>{t('literature.review.question')}</span>
        <textarea
          onChange={(event) => { setters.setQuestion(event.target.value); }}
          rows={3}
          value={state.question}
        />
      </label>
      <label>
        <span>{t('literature.review.protocol')}</span>
        <textarea
          onChange={(event) => { setters.setProtocol(event.target.value); }}
          placeholder={t('literature.review.protocol_placeholder')}
          rows={4}
          value={state.protocol}
        />
      </label>
      <label>
        <span>{t('literature.review.include_criteria')}</span>
        <textarea
          onChange={(event) => { setters.setIncludeCriteria(event.target.value); }}
          placeholder={t('literature.review.criteria_placeholder')}
          rows={3}
          value={state.includeCriteria}
        />
      </label>
      <label>
        <span>{t('literature.review.exclude_criteria')}</span>
        <textarea
          onChange={(event) => { setters.setExcludeCriteria(event.target.value); }}
          placeholder={t('literature.review.criteria_placeholder')}
          rows={3}
          value={state.excludeCriteria}
        />
      </label>
      <label>
        <span>{t('literature.review.mode')}</span>
        <select
          onChange={(event) => { setters.setMode(event.target.value as ReviewMode); }}
          value={state.mode}
        >
          <option value="single">{t('literature.review.single')}</option>
          <option value="dual_blind">{t('literature.review.dual_blind')}</option>
        </select>
      </label>
      {state.mode === 'dual_blind' && (
        <label>
          <span>{t('literature.review.reviewers')}</span>
          <input
            onChange={(event) => { setters.setReviewers(event.target.value); }}
            placeholder={t('literature.review.reviewers_placeholder')}
            value={state.reviewers}
          />
        </label>
      )}
      <button
        className="btn-gnosi btn-gnosi-primary"
        disabled={!state.question.trim() || state.busy === 'create'}
        onClick={() => void actions.createReview()}
        type="button"
      >
        <Plus size={15} /> {t('literature.review.create')}
      </button>
      <div className="literature-review-list__items">
        {state.reviews.map((review) => (
          <button
            className={state.selectedReviewId === review.id ? 'is-active' : ''}
            key={review.id}
            onClick={() => { setters.setSelectedReviewId(review.id); }}
            type="button"
          >
            <strong>{review.title}</strong>
            <span>
              {review.reviewer_mode === 'dual_blind'
                ? t('literature.review.dual_blind')
                : t('literature.review.single')}
              {' · '}{review.status}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

interface ReviewDetailProps extends ReviewSidebarProps {
  readonly selectedWorksCount: number;
}

function ReviewDetail({ controller, selectedWorksCount, t }: ReviewDetailProps) {
  const { actions, setters, state } = controller;
  const detail = state.detail;
  if (!detail) {
    return (
      <section className="literature-review-detail">
        <div className="literature-empty">
          <BookOpenCheck size={34} />
          <h2>{t('literature.review.select_title')}</h2>
          <p>{t('literature.review.select_help')}</p>
        </div>
      </section>
    );
  }
  const phases = [
    'identified',
    'title_abstract',
    'full_text_requested',
    'full_text_assessed',
    'included',
    'excluded',
  ];
  return (
    <section className="literature-review-detail">
      <header>
        <div>
          <span>{t('literature.review.eyebrow')}</span>
          <h2>{detail.review.title}</h2>
          <p>{detail.review.question}</p>
        </div>
        <div className="literature-review-detail__actions">
          <button
            className="btn-gnosi-secondary"
            disabled={!selectedWorksCount || state.busy === 'candidates'}
            onClick={() => void actions.addSelected()}
            type="button"
          >
            <Plus size={14} /> {t('literature.review.add_selected', { count: selectedWorksCount })}
          </button>
          <button
            className="btn-gnosi-secondary"
            disabled={!state.hasCurrentSearch || state.busy === 'strategy'}
            onClick={() => void actions.saveStrategy()}
            type="button"
          >
            <Archive size={14} /> {t('literature.review.save_strategy')}
          </button>
          <button
            className="btn-gnosi-secondary"
            disabled={!detail.candidates.length || state.busy.startsWith('ai:')}
            onClick={() => void actions.runReviewAi('screen')}
            type="button"
          >
            <Bot size={14} /> {t('literature.review.screen_suggestions')}
          </button>
          <button
            className="btn-gnosi-secondary"
            disabled={!detail.candidates.length || state.busy.startsWith('ai:')}
            onClick={() => void actions.runReviewAi('synthesize')}
            type="button"
          >
            <Sparkles size={14} /> {t('literature.review.synthesize')}
          </button>
          <div className="literature-snowball-action">
            <select
              aria-label={t('literature.review.snowball_direction')}
              onChange={(event) => { setters.setSnowballDirection(
                event.target.value as SnowballDirection,
              ); }}
              value={state.snowballDirection}
            >
              <option value="both">{t('literature.review.snowball_both')}</option>
              <option value="backward">{t('literature.review.snowball_backward')}</option>
              <option value="forward">{t('literature.review.snowball_forward')}</option>
            </select>
            <button
              className="btn-gnosi-secondary"
              disabled={!state.snowballSeedIds.size || state.busy === 'snowball'}
              onClick={() => void actions.runSnowball()}
              type="button"
            >
              <RefreshCw size={14} /> {t('literature.review.snowball')}
            </button>
          </div>
          <div className="literature-export-menu">
            <Download size={14} />
            {['csv', 'json', 'markdown', 'prisma-svg'].map((format) => (
              <button key={format} onClick={() => void actions.exportReview(format)} type="button">
                {format === 'prisma-svg' ? 'PRISMA SVG' : format.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </header>
      {state.aiInsight && (
        <div className="literature-ai-proposal">
          <header>
            <Bot size={16} />
            <strong>{t(`literature.review.ai_${state.aiInsight.operation}`)}</strong>
            <span>{state.aiInsight.audit.model}</span>
            <button
              aria-label={t('common.close')}
              onClick={() => { setters.setAiInsight(null); }}
              type="button"
            >
              <X size={14} />
            </button>
          </header>
          <pre>{JSON.stringify(state.aiInsight.result, null, 2)}</pre>
          <small>{t('literature.ai.human_control')}</small>
        </div>
      )}
      <details className="literature-review-protocol">
        <summary>{t('literature.review.protocol_and_criteria')}</summary>
        <h3>{t('literature.review.protocol')}</h3>
        <p>{detail.review.protocol || t('literature.review.not_recorded')}</p>
        <h3>{t('literature.review.include_criteria')}</h3>
        <ul>{(detail.review.criteria.include ?? []).map((criterion) => (
          <li key={criterion}>{criterion}</li>
        ))}</ul>
        <h3>{t('literature.review.exclude_criteria')}</h3>
        <ul>{(detail.review.criteria.exclude ?? []).map((criterion) => (
          <li key={criterion}>{criterion}</li>
        ))}</ul>
      </details>
      <details className="literature-review-protocol">
        <summary>{t('literature.review.audit_trail', { count: detail.activities.length })}</summary>
        {detail.activities.length === 0 ? <p>{t('literature.review.no_activities')}</p> : (
          detail.activities.map((activity) => (
            <article key={activity.id}>
              <header>
                <strong>{activity.activity_type}</strong>
                <time>{activity.occurred_at
                  ? new Date(activity.occurred_at).toLocaleString()
                  : ''}</time>
              </header>
              <small>{t('literature.review.activity_version', { version: activity.version ?? 1 })}</small>
              {Object.keys(activity.exact_queries ?? {}).length > 0 && (
                <pre>{JSON.stringify(activity.exact_queries, null, 2)}</pre>
              )}
              {(activity.errors ?? []).length > 0 && (
                <p className="is-error">
                  {t('literature.review.activity_errors', { count: activity.errors?.length })}
                </p>
              )}
            </article>
          ))
        )}
      </details>
      <div className="literature-review-schedule">
        <label>
          <input
            checked={state.scheduleEnabled}
            onChange={(event) => { setters.setScheduleEnabled(event.target.checked); }}
            type="checkbox"
          />
          {' '}{t('literature.review.schedule_updates')}
        </label>
        <label>
          {t('literature.review.every_days')}{' '}
          <input
            max="365"
            min="1"
            onChange={(event) => { setters.setScheduleDays(
              Math.max(1, Math.min(365, Number(event.target.value) || 1)),
            ); }}
            type="number"
            value={state.scheduleDays}
          />
        </label>
        <button
          className="btn-gnosi-secondary"
          disabled={state.busy === 'schedule'}
          onClick={() => void actions.saveSchedule()}
          type="button"
        >
          {t('common.save')}
        </button>
        <small>{t('literature.review.schedule_help')}</small>
      </div>
      <div className="literature-review-phases">
        {phases.map((phase) => (
          <span key={phase}>
            <strong>{detail.candidates.filter((candidate) => candidate.phase === phase).length}</strong>
            {t(`literature.review.phase.${phase}`)}
          </span>
        ))}
      </div>
      <div className="literature-prisma-summary">
        <span><strong>{detail.prisma.identified}</strong>{t('literature.review.prisma_identified')}</span>
        <span><strong>{detail.prisma.duplicates_removed}</strong>{t('literature.review.prisma_duplicates')}</span>
        <span><strong>{detail.prisma.screened}</strong>{t('literature.review.prisma_screened')}</span>
        <span><strong>{detail.prisma.included}</strong>{t('literature.review.prisma_included')}</span>
      </div>
      {state.snowballResult && (
        <section className="literature-snowball-results">
          <header>
            <div>
              <strong>{t('literature.review.snowball_results')}</strong>
              <small>
                {state.snowballResult.provider} · {t('literature.search.result_count', {
                  count: state.snowballResult.works.length,
                })}
              </small>
            </div>
            <button
              aria-label={t('common.close')}
              className="literature-icon-button"
              onClick={() => { setters.setSnowballResult(null); }}
              type="button"
            >
              <X size={14} />
            </button>
          </header>
          <div>
            {state.snowballResult.works.map((rawWork) => {
              const work = rawWork as LiteratureWorkView;
              return (
                <label key={work.id}>
                  <input
                    checked={state.snowballSelectedIds.has(work.id)}
                    onChange={(event) => { actions.toggleSnowballResult(
                      work.id,
                      event.target.checked,
                    ); }}
                    type="checkbox"
                  />
                  <span>
                    <strong>{work.title}</strong>
                    <small>{authorLine(work)} {work.year ? `· ${String(work.year)}` : ''}</small>
                  </span>
                </label>
              );
            })}
          </div>
          <button
            className="btn-gnosi btn-gnosi-primary"
            disabled={!state.snowballSelectedIds.size || state.busy === 'snowball-add'}
            onClick={() => void actions.addSnowballCandidates()}
            type="button"
          >
            <Plus size={14} /> {t('literature.review.add_snowball_selected', {
              count: state.snowballSelectedIds.size,
            })}
          </button>
          <small>{t('literature.review.snowball_human_add')}</small>
        </section>
      )}
      {state.snowballSeedIds.size > 0 && (
        <small className="literature-seed-count">
          {t('literature.review.snowball_seed_count', {
            count: state.snowballSeedIds.size,
            max: 20,
          })}
        </small>
      )}
      <div className="literature-candidates">
        {detail.candidates.length === 0 ? (
          <div className="literature-empty compact">
            <Archive size={28} /><p>{t('literature.review.no_candidates')}</p>
          </div>
        ) : detail.candidates.map((candidate) => (
          <CandidateCard
            busy={state.busy}
            candidate={candidate}
            key={`${candidate.id}:${candidate.phase}:${candidate.full_text ?? ''}:${candidate.resource_id ?? ''}:${candidate.full_text_evidence?.location_url ?? ''}:${candidate.full_text_evidence?.notes ?? ''}`}
            onDecide={(...args) => { void actions.decide(...args); }}
            onFullText={(...args) => { void actions.updateFullText(...args); }}
            onResolve={(...args) => { void actions.resolve(...args); }}
            onSeedChange={actions.toggleSnowballSeed}
            seedSelected={state.snowballSeedIds.has(candidate.id)}
            t={t}
          />
        ))}
      </div>
    </section>
  );
}

export function ReviewWorkspace({
  currentSearch,
  selectedWorks,
  t,
}: ReviewWorkspaceProps) {
  const controller = useLiteratureReview({ currentSearch, selectedWorks, t });
  return (
    <div className="literature-review-workspace">
      {controller.state.error && (
        <div className="literature-alert" role="alert">
          <CircleAlert size={15} /> {controller.state.error}
        </div>
      )}
      <ReviewSidebar controller={controller} t={t} />
      <ReviewDetail
        controller={controller}
        selectedWorksCount={selectedWorks.length}
        t={t}
      />
    </div>
  );
}
