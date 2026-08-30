import { useCallback, useEffect, useState } from 'react';

import { toast } from '../../../shared/notifications/toast';
import { apiErrorDetail } from '../../../shared/api/errors';
import {
  addLiteratureCandidates,
  createLiteratureActivity,
  createLiteratureReview,
  discoverLiteratureCitations,
  fetchLiteratureReview,
  fetchLiteratureReviews,
  resolveLiteratureConflict,
  runLiteratureAi,
  submitLiteratureDecision,
  updateLiteratureFullText,
  updateLiteratureReviewSchedule,
  type LiteratureFullTextInput,
  type LiteratureSnowballResult,
} from '../../../shared/api/literature';
import { downloadLiteratureReview } from '../../../shared/api/literature-specialized';
import { downloadBlob } from '../../../shared/platform/download';
import type {
  ConsensusDecision,
  LiteratureCandidate,
  LiteratureAiResultView,
  LiteratureReviewDetailView,
  LiteratureReviewView,
  LiteratureSearchView,
  LiteratureWorkView,
  ReviewMode,
  ScreeningDecision,
  SnowballDirection,
  Translate,
} from './literatureTypes';
import {
  asAiResult,
  asReview,
  asReviewDetail,
  asWork,
} from './literatureTypes';

interface UseLiteratureReviewOptions {
  readonly currentSearch: LiteratureSearchView | null;
  readonly selectedWorks: readonly LiteratureWorkView[];
  readonly t: Translate;
}

function exportFilename(contentDisposition: string, format: string): string {
  return contentDisposition.match(/filename="([^"]+)"/)?.[1]
    ?? `literature-review.${format === 'prisma-svg' ? 'svg' : format}`;
}

export function useLiteratureReview({
  currentSearch,
  selectedWorks,
  t,
}: UseLiteratureReviewOptions) {
  const [reviews, setReviews] = useState<readonly LiteratureReviewView[]>([]);
  const [selectedReviewId, setSelectedReviewId] = useState('');
  const [detail, setDetail] = useState<LiteratureReviewDetailView | null>(null);
  const [question, setQuestion] = useState('');
  const [protocol, setProtocol] = useState('');
  const [includeCriteria, setIncludeCriteria] = useState('');
  const [excludeCriteria, setExcludeCriteria] = useState('');
  const [mode, setMode] = useState<ReviewMode>('single');
  const [reviewers, setReviewers] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [aiInsight, setAiInsight] = useState<LiteratureAiResultView | null>(null);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleDays, setScheduleDays] = useState(7);
  const [snowballDirection, setSnowballDirection] = useState<SnowballDirection>('both');
  const [snowballSeedIds, setSnowballSeedIds] = useState<ReadonlySet<string>>(new Set());
  const [snowballResult, setSnowballResult] = useState<LiteratureSnowballResult | null>(null);
  const [snowballSelectedIds, setSnowballSelectedIds] = useState<ReadonlySet<string>>(new Set());

  const loadReviews = useCallback(async () => {
    try {
      setReviews((await fetchLiteratureReviews()).map(asReview));
    } catch (requestError) {
      setError(apiErrorDetail(requestError, t('literature.review.load_error')));
    }
  }, [t]);

  const loadDetail = useCallback(async (reviewId: string) => {
    if (!reviewId) {
      setDetail(null);
      return;
    }
    try {
      const nextDetail = asReviewDetail(await fetchLiteratureReview(reviewId));
      setDetail(nextDetail);
      const schedule = nextDetail.review.configuration.schedule ?? {};
      setScheduleEnabled(Boolean(schedule.enabled));
      setScheduleDays(schedule.interval_days ?? 7);
      setSnowballSeedIds((current) => {
        const available = new Set(nextDetail.candidates.map((candidate) => candidate.id));
        return new Set([...current].filter((candidateId) => available.has(candidateId)));
      });
    } catch (requestError) {
      setError(apiErrorDetail(requestError, t('literature.review.load_error')));
    }
  }, [t]);

  useEffect(() => { void Promise.resolve().then(loadReviews); }, [loadReviews]);
  useEffect(() => {
    void Promise.resolve().then(() => loadDetail(selectedReviewId));
  }, [loadDetail, selectedReviewId]);

  const createReview = async (): Promise<void> => {
    setBusy('create');
    try {
      const created = await createLiteratureReview({
        configuration: {},
        criteria: {
          exclude: excludeCriteria.split('\n').map((value) => value.trim()).filter(Boolean),
          include: includeCriteria.split('\n').map((value) => value.trim()).filter(Boolean),
        },
        protocol,
        question,
        reviewer_mode: mode,
        reviewers: reviewers.split(',').map((value) => value.trim()).filter(Boolean),
        title: question,
      });
      setQuestion('');
      setProtocol('');
      setIncludeCriteria('');
      setExcludeCriteria('');
      await loadReviews();
      setSelectedReviewId(created.id);
    } catch (requestError) {
      setError(apiErrorDetail(requestError, t('literature.review.create_error')));
    } finally {
      setBusy('');
    }
  };

  const addSelected = async (): Promise<void> => {
    if (!selectedReviewId || !selectedWorks.length) return;
    setBusy('candidates');
    try {
      await addLiteratureCandidates(selectedReviewId, { works: [...selectedWorks] });
      await loadDetail(selectedReviewId);
      toast.success(t('literature.review.candidates_added'));
    } catch (requestError) {
      setError(apiErrorDetail(requestError, t('literature.review.candidates_error')));
    } finally {
      setBusy('');
    }
  };

  const decide = async (
    candidate: LiteratureCandidate,
    decision: ScreeningDecision,
    reason: string,
    notes: string,
  ): Promise<void> => {
    setBusy(candidate.id);
    try {
      await submitLiteratureDecision(selectedReviewId, candidate.id, {
        decision,
        notes,
        phase: candidate.phase,
        reason,
      });
      await loadDetail(selectedReviewId);
    } catch (requestError) {
      setError(apiErrorDetail(requestError, t('literature.review.decision_error')));
    } finally {
      setBusy('');
    }
  };

  const resolve = async (
    candidate: LiteratureCandidate,
    decision: ConsensusDecision,
    reason: string,
    notes: string,
  ): Promise<void> => {
    setBusy(candidate.id);
    try {
      await resolveLiteratureConflict(selectedReviewId, candidate.id, {
        decision,
        notes,
        reason: reason || t('literature.review.consensus_reason'),
      });
      await loadDetail(selectedReviewId);
    } catch (requestError) {
      setError(apiErrorDetail(requestError, t('literature.review.decision_error')));
    } finally {
      setBusy('');
    }
  };

  const updateFullText = async (
    candidate: LiteratureCandidate,
    payload: LiteratureFullTextInput,
  ): Promise<void> => {
    setBusy(`full-text:${candidate.id}`);
    try {
      await updateLiteratureFullText(selectedReviewId, candidate.id, payload);
      await loadDetail(selectedReviewId);
      toast.success(t('literature.review.full_text_saved'));
    } catch (requestError) {
      setError(apiErrorDetail(requestError, t('literature.review.full_text_error')));
    } finally {
      setBusy('');
    }
  };

  const exportReview = async (format: string): Promise<void> => {
    try {
      const download = await downloadLiteratureReview(selectedReviewId, format);
      downloadBlob(download.blob, exportFilename(download.contentDisposition, format));
    } catch {
      setError(t('literature.review.export_error'));
    }
  };

  const saveStrategy = async (): Promise<void> => {
    if (!selectedReviewId || !currentSearch?.id) return;
    setBusy('strategy');
    try {
      await createLiteratureActivity(selectedReviewId, {
        activity_type: 'search_strategy',
        ai_audit: { operations: currentSearch.ai_audits ?? [] },
        counts: {
          search_id: currentSearch.id,
          ...(currentSearch.counts ?? {}),
          results: currentSearch.result_count ?? 0,
        },
        errors: (currentSearch.errors ?? []).map((item) => ({ ...item })),
        exact_queries: currentSearch.exact_queries ?? {},
        export_format: '',
        notes: '',
        source_snapshot: [...(currentSearch.source_snapshots ?? [])],
        strategy: {
          filters: currentSearch.filters,
          query: currentSearch.query,
          source_ids: currentSearch.source_ids,
          source_queries: currentSearch.source_queries ?? {},
        },
      });
      await loadDetail(selectedReviewId);
      toast.success(t('literature.review.strategy_saved'));
    } catch (requestError) {
      setError(apiErrorDetail(requestError, t('literature.review.strategy_error')));
    } finally {
      setBusy('');
    }
  };

  const runReviewAi = async (operation: 'screen' | 'synthesize'): Promise<void> => {
    if (!detail?.candidates.length) return;
    setBusy(`ai:${operation}`);
    try {
      setAiInsight(asAiResult(await runLiteratureAi({
        operation,
        payload: {
          criteria: detail.review.criteria,
          question: detail.review.question,
          works: detail.candidates.map((candidate) => candidate.work),
        },
        review_id: selectedReviewId,
      })));
    } catch (requestError) {
      setError(apiErrorDetail(requestError, t('literature.ai.error')));
    } finally {
      setBusy('');
    }
  };

  const runSnowball = async (): Promise<void> => {
    const seeds = (detail?.candidates ?? [])
      .filter((candidate) => snowballSeedIds.has(candidate.id))
      .map((candidate) => candidate.work);
    if (!seeds.length) return;
    setBusy('snowball');
    try {
      setSnowballResult(await discoverLiteratureCitations(selectedReviewId, {
        direction: snowballDirection,
        limit_per_seed: 25,
        seeds,
      }));
      setSnowballSelectedIds(new Set());
    } catch (requestError) {
      setError(apiErrorDetail(requestError, t('literature.review.snowball_error')));
    } finally {
      setBusy('');
    }
  };

  const addSnowballCandidates = async (): Promise<void> => {
    const works = (snowballResult?.works ?? [])
      .map(asWork)
      .filter((work) => snowballSelectedIds.has(work.id));
    if (!works.length) return;
    setBusy('snowball-add');
    try {
      await addLiteratureCandidates(selectedReviewId, {
        activity_id: snowballResult?.activity_id ?? '',
        works,
      });
      await loadDetail(selectedReviewId);
      setSnowballResult(null);
      setSnowballSelectedIds(new Set());
      toast.success(t('literature.review.candidates_added'));
    } catch (requestError) {
      setError(apiErrorDetail(requestError, t('literature.review.candidates_error')));
    } finally {
      setBusy('');
    }
  };

  const saveSchedule = async (): Promise<void> => {
    if (!selectedReviewId) return;
    const existingStrategy = detail?.review.configuration.schedule?.strategy ?? {};
    const strategy = currentSearch?.id ? {
      filters: currentSearch.filters,
      limit_per_source: currentSearch.limit_per_source ?? 25,
      query: currentSearch.query,
      source_ids: currentSearch.source_ids,
      source_queries: currentSearch.source_queries ?? {},
    } : existingStrategy;
    if (scheduleEnabled && !strategy.query) {
      setError(t('literature.review.schedule_needs_strategy'));
      return;
    }
    setBusy('schedule');
    try {
      await updateLiteratureReviewSchedule(selectedReviewId, {
        enabled: scheduleEnabled,
        interval_days: scheduleDays,
        strategy,
      });
      await loadDetail(selectedReviewId);
      toast.success(t('literature.review.schedule_saved'));
    } catch (requestError) {
      setError(apiErrorDetail(requestError, t('literature.review.schedule_error')));
    } finally {
      setBusy('');
    }
  };

  const toggleSnowballSeed = (candidateId: string, checked: boolean): void => {
    setSnowballSeedIds((current) => {
      const next = new Set(current);
      if (checked && next.size < 20) next.add(candidateId);
      else if (!checked) next.delete(candidateId);
      return next;
    });
  };

  const toggleSnowballResult = (workId: string, checked: boolean): void => {
    setSnowballSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(workId);
      else next.delete(workId);
      return next;
    });
  };

  return {
    actions: {
      addSelected,
      addSnowballCandidates,
      createReview,
      decide,
      exportReview,
      resolve,
      runReviewAi,
      runSnowball,
      saveSchedule,
      saveStrategy,
      toggleSnowballResult,
      toggleSnowballSeed,
      updateFullText,
    },
    state: {
      aiInsight,
      busy,
      detail,
      error,
      excludeCriteria,
      includeCriteria,
      hasCurrentSearch: Boolean(currentSearch?.id),
      mode,
      protocol,
      question,
      reviewers,
      reviews,
      scheduleDays,
      scheduleEnabled,
      selectedReviewId,
      snowballDirection,
      snowballResult,
      snowballSeedIds,
      snowballSelectedIds,
    },
    setters: {
      setAiInsight,
      setExcludeCriteria,
      setIncludeCriteria,
      setMode,
      setProtocol,
      setQuestion,
      setReviewers,
      setScheduleDays,
      setScheduleEnabled,
      setSelectedReviewId,
      setSnowballDirection,
      setSnowballResult,
    },
  };
}

export type LiteratureReviewController = ReturnType<typeof useLiteratureReview>;
