import { useState } from 'react';
import { Check, Users, X } from 'lucide-react';

import type { LiteratureFullTextInput } from '../../../shared/api/literature';
import type {
  ConsensusDecision,
  FullTextStatus,
  LiteratureCandidate,
  ScreeningDecision,
  Translate,
} from './literatureTypes';

interface CandidateCardProps {
  readonly busy: string;
  readonly candidate: LiteratureCandidate;
  readonly onDecide: (
    candidate: LiteratureCandidate,
    decision: ScreeningDecision,
    reason: string,
    notes: string,
  ) => void;
  readonly onFullText: (
    candidate: LiteratureCandidate,
    payload: LiteratureFullTextInput,
  ) => void;
  readonly onResolve: (
    candidate: LiteratureCandidate,
    decision: ConsensusDecision,
    reason: string,
    notes: string,
  ) => void;
  readonly onSeedChange: (candidateId: string, checked: boolean) => void;
  readonly seedSelected: boolean;
  readonly t: Translate;
}

const FULL_TEXT_STATUSES: readonly FullTextStatus[] = [
  'not_requested',
  'requested',
  'available_oa',
  'attached',
  'unavailable',
  'assessed',
];

export function CandidateCard({
  busy,
  candidate,
  onDecide,
  onFullText,
  onResolve,
  onSeedChange,
  seedSelected,
  t,
}: CandidateCardProps) {
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [fullTextStatus, setFullTextStatus] = useState<FullTextStatus>(
    candidate.full_text ?? 'not_requested',
  );
  const [resourceId, setResourceId] = useState(candidate.resource_id ?? '');
  const [locationUrl, setLocationUrl] = useState(
    candidate.full_text_evidence?.location_url ?? '',
  );
  const [fullTextNotes, setFullTextNotes] = useState(
    candidate.full_text_evidence?.notes ?? '',
  );
  const terminal = ['included', 'excluded'].includes(candidate.phase);
  const openLocations = (candidate.work.locations ?? []).filter((location) => (
    location.is_oa === true || candidate.work.open_access?.is_oa === true
  ));
  const selectedLocation = openLocations.find((location) => (
    [location.url, location.landing_page_url, location.pdf_url].includes(locationUrl)
  ));

  const submitDecision = (decision: ScreeningDecision): void => {
    if (decision === 'exclude' && !reason.trim()) return;
    onDecide(candidate, decision, reason, notes);
  };
  const submitResolution = (decision: ConsensusDecision): void => {
    if (decision === 'exclude' && !reason.trim()) return;
    onResolve(candidate, decision, reason, notes);
  };

  return (
    <article>
      <div className="literature-candidate-main">
        <div className="literature-result__badges">
          <label className="literature-seed-toggle">
            <input
              checked={seedSelected}
              onChange={(event) => { onSeedChange(candidate.id, event.target.checked); }}
              type="checkbox"
            />
            {' '}{t('literature.review.snowball_seed')}
          </label>
          <span>{t(`literature.review.phase.${candidate.phase}`)}</span>
          {candidate.blind_pending && (
            <span><Users size={11} /> {t('literature.review.blind_pending')}</span>
          )}
          {candidate.conflict && (
            <span className="is-warning">{t('literature.review.conflict')}</span>
          )}
          <span>{t(`literature.review.full_text_status.${candidate.full_text ?? 'not_requested'}`)}</span>
        </div>
        <h3>{candidate.title}</h3>
        <p>{candidate.work.abstract || t('literature.preview.no_abstract')}</p>
        {!terminal && (
          <div className="literature-decision-fields">
            <label>
              <span>{t('literature.review.exclusion_reason')}</span>
              <input
                onChange={(event) => { setReason(event.target.value); }}
                placeholder={t('literature.review.exclusion_reason_placeholder')}
                value={reason}
              />
            </label>
            <label>
              <span>{t('literature.review.decision_notes')}</span>
              <textarea
                onChange={(event) => { setNotes(event.target.value); }}
                rows={2}
                value={notes}
              />
            </label>
          </div>
        )}
      </div>
      {!terminal && (
        <div className="literature-candidate-actions">
          {candidate.conflict ? (
            <>
              <button
                disabled={busy === candidate.id}
                onClick={() => { submitResolution('include'); }}
                type="button"
              >
                <Check size={14} /> {t('literature.review.resolve_include')}
              </button>
              <button
                className="is-danger"
                disabled={busy === candidate.id || !reason.trim()}
                onClick={() => { submitResolution('exclude'); }}
                type="button"
              >
                <X size={14} /> {t('literature.review.resolve_exclude')}
              </button>
            </>
          ) : (
            <>
              <button
                disabled={busy === candidate.id}
                onClick={() => { submitDecision('include'); }}
                type="button"
              >
                <Check size={14} /> {t('literature.review.include')}
              </button>
              <button
                disabled={busy === candidate.id}
                onClick={() => { submitDecision('uncertain'); }}
                type="button"
              >
                {t('literature.review.uncertain')}
              </button>
              <button
                className="is-danger"
                disabled={busy === candidate.id || !reason.trim()}
                onClick={() => { submitDecision('exclude'); }}
                type="button"
              >
                <X size={14} /> {t('literature.review.exclude')}
              </button>
            </>
          )}
        </div>
      )}
      <details
        className="literature-full-text"
        open={['full_text_requested', 'full_text_assessed'].includes(candidate.phase)}
      >
        <summary>{t('literature.review.full_text_workflow')}</summary>
        <div>
          <label>
            <span>{t('literature.review.full_text_status_label')}</span>
            <select
              onChange={(event) => { setFullTextStatus(event.target.value as FullTextStatus); }}
              value={fullTextStatus}
            >
              {FULL_TEXT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`literature.review.full_text_status.${status}`)}
                </option>
              ))}
            </select>
          </label>
          {fullTextStatus === 'available_oa' && (
            <label>
              <span>{t('literature.review.verified_location')}</span>
              <select onChange={(event) => { setLocationUrl(event.target.value); }} value={locationUrl}>
                <option value="">{t('literature.review.select_location')}</option>
                {openLocations.flatMap((location, index) => (
                  [location.pdf_url, location.landing_page_url ?? location.url]
                    .filter((url): url is string => Boolean(url))
                    .map((url) => (
                      <option key={`${url}-${index.toString()}`} value={url}>
                        {location.license ?? url}
                      </option>
                    ))
                ))}
              </select>
            </label>
          )}
          {fullTextStatus === 'attached' && (
            <label>
              <span>{t('literature.review.resource_id')}</span>
              <input onChange={(event) => { setResourceId(event.target.value); }} value={resourceId} />
            </label>
          )}
          <label>
            <span>{t('literature.review.full_text_notes')}</span>
            <textarea
              onChange={(event) => { setFullTextNotes(event.target.value); }}
              rows={2}
              value={fullTextNotes}
            />
          </label>
          <button
            className="btn-gnosi-secondary"
            disabled={
              busy === `full-text:${candidate.id}`
              || (fullTextStatus === 'available_oa' && !locationUrl)
              || (fullTextStatus === 'attached' && !resourceId.trim())
            }
            onClick={() => { onFullText(candidate, {
              license: selectedLocation?.license ?? '',
              location_url: locationUrl,
              notes: fullTextNotes,
              resource_id: resourceId,
              status: fullTextStatus,
            }); }}
            type="button"
          >
            {t('literature.review.save_full_text')}
          </button>
        </div>
      </details>
    </article>
  );
}
