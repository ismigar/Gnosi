import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {KIND_OPTIONS, DATE_PRESETS, SIZE_PRESETS, SORT_OPTIONS} from './constants';
import {isoDaysAgo, type MediaFilters, type MediaSort} from './model';
import {Calendar, Tag, X, ArrowDown, ArrowUp, Eraser, HardDrive, BookmarkPlus, BookmarkCheck} from 'lucide-react';
interface MediaToolbarProps {
filters: MediaFilters; sort: MediaSort; onFiltersChange: (filters: MediaFilters) => void;
onSortChange: (sort: MediaSort) => void; onReset: () => void; hasActiveFilters: boolean;
activeViewId: string | null; onSaveAsView: () => void; onUpdateView: () => void;
}
export function MediaToolbar({
  filters,
  sort,
  onFiltersChange,
  onSortChange,
  onReset,
  hasActiveFilters,
  activeViewId,
  onSaveAsView,
  onUpdateView,
}: MediaToolbarProps) {
  const { t } = useTranslation();
  const [tagDraft, setTagDraft] = useState('');

  // Multi-select OR: clicking adds/removes a type from the selection. No pill
  // active = show everything. Active pills are shown in blue, so the
  // multiple selection is visually obvious.
  const toggleKind = (key: string) => {
    const set = new Set(filters.kinds);
    if (set.has(key)) set.delete(key); else set.add(key);
    onFiltersChange({ ...filters, kinds: Array.from(set) });
  };

  const setDatePreset = (key: string) => {
    if (key === 'all') {
      onFiltersChange({ ...filters, datePreset: key, mtimeFrom: '', mtimeTo: '' });
    } else if (key === 'custom') {
      onFiltersChange({ ...filters, datePreset: key });
    } else {
      const preset = DATE_PRESETS.find(p => p.key === key);
      onFiltersChange({
        ...filters,
        datePreset: key,
        mtimeFrom: isoDaysAgo(preset?.days ?? 0),
        mtimeTo: '',
      });
    }
  };

  const setSizePreset = (key: string) => {
    onFiltersChange({ ...filters, sizePreset: key });
  };

  const addTag = () => {
    const t = tagDraft.trim().toLowerCase();
    if (!t) return;
    if (filters.tagsAny.includes(t)) { setTagDraft(''); return; }
    onFiltersChange({ ...filters, tagsAny: [...filters.tagsAny, t] });
    setTagDraft('');
  };

  const removeTag = (t: string) => {
    onFiltersChange({ ...filters, tagsAny: filters.tagsAny.filter(x => x !== t) });
  };

  return (
    <div className="px-6 py-3 bg-[var(--bg-primary)] border-b border-[var(--border-primary)] flex flex-wrap items-center gap-3 text-xs">
      {/* Tipus */}
      <div className="flex items-center gap-1">
        {KIND_OPTIONS.map(({ key, labelKey, Icon }) => {
          const label = t(labelKey);
          const active = filters.kinds.includes(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => { toggleKind(key); }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-all ${
                active
                  ? 'bg-[var(--gnosi-action-bg)] text-white border-[var(--gnosi-action-bg)]'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]'
              }`}
              title={label}
            >
              <Icon size={12} />
              <span className="font-medium">{label}</span>
            </button>
          );
        })}
      </div>

      <div className="h-5 w-px bg-[var(--border-primary)] opacity-60" />

      {/* Data (mtime) */}
      <label className="flex items-center gap-1.5 text-[var(--text-tertiary)]">
        <Calendar size={12} />
        <select
          value={filters.datePreset}
          onChange={(e) => { setDatePreset(e.target.value); }}
          aria-label={t('media.date_filter_label', 'Date filter')}
          className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md px-2 py-1 text-xs"
        >
          {DATE_PRESETS.map(p => <option key={p.key} value={p.key}>{t(p.labelKey)}</option>)}
        </select>
      </label>
      {filters.datePreset === 'custom' && (
        <div className="flex items-center gap-1">
          <input
            type="date"
            value={filters.mtimeFrom}
            onChange={(e) => { onFiltersChange({ ...filters, mtimeFrom: e.target.value }); }}
            className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md px-2 py-1 text-xs"
          />
          <span className="text-[var(--text-tertiary)]">–</span>
          <input
            type="date"
            value={filters.mtimeTo}
            onChange={(e) => { onFiltersChange({ ...filters, mtimeTo: e.target.value }); }}
            className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md px-2 py-1 text-xs"
          />
        </div>
      )}

      <div className="h-5 w-px bg-[var(--border-primary)] opacity-60" />

      {/* Tags */}
      <div className="flex items-center gap-1.5">
        <Tag size={12} className="text-[var(--text-tertiary)]" />
        {filters.tagsAny.map(t => (
          <span key={t} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] font-medium">
            {t}
            <button type="button" onClick={() => { removeTag(t); }} className="hover:text-red-500">
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          type="text"
          placeholder={t('media.tag_placeholder')}
          value={tagDraft}
          onChange={(e) => { setTagDraft(e.target.value); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
          className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md px-2 py-1 text-xs w-28"
        />
      </div>

      <div className="h-5 w-px bg-[var(--border-primary)] opacity-60" />

      {/* Mida */}
      <label className="flex items-center gap-1.5 text-[var(--text-tertiary)]">
        <HardDrive size={12} />
        <select
          value={filters.sizePreset}
          onChange={(e) => { setSizePreset(e.target.value); }}
          aria-label={t('media.size_filter_label', 'Size filter')}
          className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md px-2 py-1 text-xs"
        >
          {SIZE_PRESETS.map(p => <option key={p.key} value={p.key}>{p.labelKey ? t(p.labelKey) : p.label}</option>)}
        </select>
      </label>

      <div className="h-5 w-px bg-[var(--border-primary)] opacity-60" />

      {/* Sort */}
      <div className="flex items-center gap-1">
        <select
          value={sort.field}
          onChange={(e) => { onSortChange({ ...sort, field: e.target.value }); }}
          className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md px-2 py-1 text-xs"
          title={t('media.sort_field_title')}
          aria-label={t('media.sort_field_title')}
        >
          {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{t(o.labelKey)}</option>)}
        </select>
        <button
          type="button"
          onClick={() => { onSortChange({ ...sort, dir: sort.dir === 'desc' ? 'asc' : 'desc' }); }}
          className="p-1 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]"
          title={sort.dir === 'desc' ? t('media.sort_desc') : t('media.sort_asc')}
        >
          {sort.dir === 'desc' ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
        </button>
      </div>

      {/* Views + Reset */}
      {(hasActiveFilters || activeViewId) && (
        <div className="ml-auto flex items-center gap-2">
          {activeViewId ? (
            <button
              type="button"
              onClick={onUpdateView}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10 transition-all font-medium"
              title={t('media.update_view_title')}
            >
              <BookmarkCheck size={12} />
              <span>{t('media.update_view')}</span>
            </button>
          ) : hasActiveFilters ? (
            <button
              type="button"
              onClick={onSaveAsView}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10 transition-all font-medium"
              title={t('media.save_as_view_title')}
            >
              <BookmarkPlus size={12} />
              <span>{t('media.save_as_view')}</span>
            </button>
          ) : null}
          {(hasActiveFilters || activeViewId) && (
            <button
              type="button"
              onClick={onReset}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-all"
              title={t('media.clear_filters_title')}
            >
              <Eraser size={12} />
              <span>{t('media.clear_filters')}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
