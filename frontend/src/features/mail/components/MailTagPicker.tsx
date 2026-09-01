import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type SyntheticEvent,
} from 'react';
import { Check, Plus, Trash2, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useModalKeyboard } from '../../../shared/hooks/useModalKeyboard';
import type { MailTag, MailTagCreate } from '../../../shared/api/mail';


const PRESET_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280',
] as const;


interface TagColorDotProps {
  readonly color: string;
  readonly size?: number;
}


function TagColorDot({ color, size = 10 }: TagColorDotProps) {
  return (
    <span style={{
      backgroundColor: color,
      borderRadius: '50%',
      display: 'inline-block',
      flexShrink: 0,
      height: size,
      width: size,
    }} />
  );
}


interface TagCreateFormProps {
  readonly onCancel: () => void;
  readonly onSave: (input: MailTagCreate) => Promise<unknown>;
}


function TagCreateForm({ onCancel, onSave }: TagCreateFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(PRESET_COLORS[4]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ): void => {
    event.preventDefault();
    if (!name.trim()) return;
    void onSave({ color, name: name.trim() });
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{ borderTop: '1px solid var(--border-subtle, #333)', padding: '8px 10px' }}
    >
      <input
        onChange={(event) => {
          setName(event.target.value);
        }}
        placeholder={t('mail.tag_name_placeholder', 'Tag name...')}
        ref={inputRef}
        style={{
          background: 'var(--bg-input, #1a1a1a)',
          border: '1px solid var(--border-subtle, #444)',
          borderRadius: 4,
          color: 'var(--text-primary, #fff)',
          fontSize: 13,
          marginBottom: 6,
          padding: '4px 8px',
          width: '100%',
        }}
        value={name}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
        {PRESET_COLORS.map((presetColor) => (
          <button
            key={presetColor}
            onClick={() => {
              setColor(presetColor);
            }}
            style={{
              backgroundColor: presetColor,
              border: 'none',
              borderRadius: '50%',
              cursor: 'pointer',
              height: 18,
              outline: color === presetColor ? '2px solid #fff' : 'none',
              outlineOffset: 1,
              width: 18,
            }}
            type="button"
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{ background: 'transparent', border: '1px solid #444', borderRadius: 4, color: '#aaa', cursor: 'pointer', fontSize: 12, padding: '3px 10px' }}
          type="button"
        >
          {t('common.cancel_short', 'Cancel')}
        </button>
        <button
          disabled={!name.trim()}
          style={{ background: '#3b82f6', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: 12, padding: '3px 10px' }}
          type="submit"
        >
          {t('common.create', 'Create')}
        </button>
      </div>
    </form>
  );
}


interface AnchorPosition {
  readonly bottom: number;
  readonly left: number;
}


export interface MailTagPickerProps {
  readonly anchorRect?: AnchorPosition | null;
  readonly onClose: () => void;
  readonly onCreateTag: (input: MailTagCreate) => Promise<unknown>;
  readonly onDeleteTag: (id: string) => unknown;
  readonly onToggleTag: (id: string) => unknown;
  readonly selectedTagIds?: readonly string[];
  readonly tags: readonly MailTag[];
}


export default function MailTagPicker({
  anchorRect,
  onClose,
  onCreateTag,
  onDeleteTag,
  onToggleTag,
  selectedTagIds = [],
  tags,
}: MailTagPickerProps) {
  const { t } = useTranslation();
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent): void => {
      if (
        event.target instanceof Node
        && panelRef.current
        && !panelRef.current.contains(event.target)
      ) onClose();
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [onClose]);

  useModalKeyboard({ isOpen: true, onClose });

  const position: CSSProperties = anchorRect ? {
    left: Math.min(anchorRect.left, globalThis.innerWidth - 220),
    position: 'fixed',
    top: Math.min(anchorRect.bottom + 4, globalThis.innerHeight - 320),
    zIndex: 'var(--z-popover)',
  } : {
    left: '50%',
    position: 'fixed',
    top: '50%',
    transform: 'translate(-50%,-50%)',
    zIndex: 'var(--z-popover)',
  };

  return createPortal((
    <div
      ref={panelRef}
      style={{
        ...position,
        background: 'var(--bg-surface, #1c1c1c)',
        border: '1px solid var(--border-subtle, #333)',
        borderRadius: 8,
        boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
        overflow: 'hidden',
        width: 210,
      }}
    >
      <div style={{ color: '#888', fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', padding: '8px 10px 4px', textTransform: 'uppercase' }}>
        {t('mail.labels', 'Labels')}
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        {tags.length === 0 && !showCreate && (
          <div style={{ color: '#666', fontSize: 13, padding: '8px 10px' }}>
            {t('mail.no_tags', 'No tags')}
          </div>
        )}
        {tags.map((tag) => {
          const isSelected = selectedTagIds.includes(tag.id);
          return (
            <div
              key={tag.id}
              onClick={() => onToggleTag(tag.id)}
              onMouseEnter={(event) => {
                event.currentTarget.style.background = 'rgba(255,255,255,0.06)';
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background = 'transparent';
              }}
              style={{ alignItems: 'center', borderRadius: 4, cursor: 'pointer', display: 'flex', gap: 8, margin: '1px 4px', padding: '5px 10px' }}
            >
              <TagColorDot color={tag.color} />
              <span style={{ color: 'var(--text-primary, #eee)', flex: 1, fontSize: 13 }}>{tag.name}</span>
              {isSelected && <Check color="#22c55e" size={13} />}
              {confirmDelete === tag.id ? (
                <span
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                  style={{ display: 'flex', gap: 4 }}
                >
                  <button
                    onClick={() => {
                      onDeleteTag(tag.id);
                      setConfirmDelete(null);
                    }}
                    style={{ background: '#ef4444', border: 'none', borderRadius: 3, color: '#fff', cursor: 'pointer', fontSize: 11, padding: '1px 5px' }}
                  >
                    {t('common.delete', 'Delete')}
                  </button>
                  <button
                    onClick={() => {
                      setConfirmDelete(null);
                    }}
                    style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer' }}
                  >
                    <X size={12} />
                  </button>
                </span>
              ) : (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    setConfirmDelete(tag.id);
                  }}
                  style={{ alignItems: 'center', background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', display: 'flex', padding: 2 }}
                  title={t('mail.delete_tag_tooltip', 'Delete tag')}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {showCreate ? (
        <TagCreateForm
          onCancel={() => {
            setShowCreate(false);
          }}
          onSave={async (input) => {
            await onCreateTag(input);
            setShowCreate(false);
          }}
        />
      ) : (
        <button
          onClick={() => {
            setShowCreate(true);
          }}
          style={{ alignItems: 'center', background: 'transparent', border: 'none', borderTop: '1px solid var(--border-subtle, #333)', color: '#888', cursor: 'pointer', display: 'flex', fontSize: 13, gap: 6, padding: '7px 10px', width: '100%' }}
        >
          <Plus size={13} /> {t('mail.new_tag', 'New tag')}
        </button>
      )}
    </div>
  ), document.body);
}


export interface TagPillProps {
  readonly onRemove?: (id: string) => unknown;
  readonly tag: MailTag;
}


export function TagPill({ tag, onRemove }: TagPillProps) {
  const handleRemove = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    onRemove?.(tag.id);
  };
  return (
    <span style={{ alignItems: 'center', backgroundColor: `${tag.color}22`, border: `1px solid ${tag.color}55`, borderRadius: 12, color: tag.color, display: 'inline-flex', fontSize: 11, fontWeight: 500, gap: 4, lineHeight: '16px', padding: '1px 7px', whiteSpace: 'nowrap' }}>
      <TagColorDot color={tag.color} size={6} />
      {tag.name}
      {onRemove && (
        <button
          onClick={handleRemove}
          style={{ background: 'transparent', border: 'none', color: tag.color, cursor: 'pointer', display: 'flex', lineHeight: 1, padding: 0 }}
        >
          <X size={10} />
        </button>
      )}
    </span>
  );
}
