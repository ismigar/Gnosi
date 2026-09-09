import { ChevronDown } from 'lucide-react';
import { IconRenderer } from '../../../shared/ui/previews/IconRenderer';
import { DeferredLucideIcon } from '../../../shared/ui/previews/DeferredLucideIcon';
import { Search } from 'lucide-react';
import { useCallback } from 'react';
import { useEffect } from 'react';
import { useMemo } from 'react';
import { useModalKeyboard } from '../../../shared/hooks/useModalKeyboard';
import { useRef } from 'react';
import { useState } from 'react';
import { subscribeDocumentEvent } from '../../../shared/platform/browser-events';

const AGENT_ICON_FAVORITES = [
  'Brain', 'Bot', 'Sparkles', 'Lightbulb', 'BookOpen', 'Search', 'PenTool',
  'MessageCircle', 'Heart', 'Rocket', 'Shield', 'Workflow', 'Activity',
  'AlarmClock', 'Archive', 'Atom', 'BadgeCheck', 'BarChart3', 'Bell', 'Binary',
  'Blocks', 'BookMarked', 'Bookmark', 'BriefcaseBusiness', 'Calculator',
  'CalendarDays', 'Camera', 'ChartNoAxesCombined', 'CheckCircle2', 'CircleHelp',
  'ClipboardCheck', 'Cloud', 'Code2', 'Compass', 'Cpu', 'Database', 'FileText',
  'Fingerprint', 'Flame', 'FolderOpen', 'Gamepad2', 'Gem', 'Globe2',
  'GraduationCap', 'HandHeart', 'Headphones', 'House', 'Image', 'KeyRound',
  'Languages', 'Laptop', 'Layers3', 'Leaf', 'Library', 'Link2', 'ListChecks',
  'LockKeyhole', 'Mail', 'Map', 'MapPin', 'Megaphone', 'MessageSquareText',
  'Mic', 'Monitor', 'Moon', 'Music', 'Network', 'NotebookPen', 'Palette',
  'Phone', 'PieChart', 'Puzzle', 'Radio', 'Route', 'Scale', 'Send', 'Server',
  'Settings2', 'ShoppingBag', 'Star', 'Sun', 'Target', 'Telescope', 'Timer',
  'UserRound', 'UsersRound', 'WandSparkles', 'Wrench', 'Zap',
];
const getAgentIconValue = (name: string, color = 'blue') => `lucide:${name}:${color}`;

export const AgentIconSelect = ({ value, onChange, label, searchPlaceholder, noResultsLabel }: { value?: string; onChange: (value: string) => void; label: string; searchPlaceholder: string; noResultsLabel: string }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [availableIcons, setAvailableIcons] = useState<readonly string[]>(AGENT_ICON_FAVORITES);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const visibleIcons = useMemo(
    () => normalizedSearch
      ? availableIcons.filter(name => name.toLowerCase().includes(normalizedSearch))
      : AGENT_ICON_FAVORITES,
    [availableIcons, normalizedSearch]
  );
  const currentIconName = typeof value === 'string' && value.startsWith('lucide:')
    ? (value.split(':')[1] ?? '')
    : '';
  const closePicker = useCallback(() => {
    setIsOpen(false);
    setSearchTerm('');
  }, []);

  useModalKeyboard({
    isOpen,
    onClose: closePicker,
  });

  useEffect(() => {
    if (!isOpen) return undefined;

    // The names are metadata. Importing Lucide's component registry here made
    // opening any settings tab download every icon, even with this picker closed.
    let active = true;
    void import('lucide-react/dynamic').then(({ iconNames }) => {
      if (active) setAvailableIcons(iconNames.map(name => name.split('-')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('')).sort());
    }).catch(() => { /* Keep the built-in favorites usable if loading fails. */ });

    const handlePointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node && rootRef.current?.contains(event.target))) closePicker();
    };

    const unsubscribe = subscribeDocumentEvent('mousedown', handlePointerDown);
    return () => { active = false; unsubscribe(); };
  }, [closePicker, isOpen]);

  const toggleOpen = () => {
    if (isOpen) closePicker();
    else setIsOpen(true);
  };

  return (
    <div
      ref={rootRef}
      style={{ position: 'relative', width: '72px' }}
    >
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={toggleOpen}
        style={{
          width: '72px', height: '48px', padding: '0 10px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderRadius: '14px', border: '1px solid var(--gnosi-blue)',
          background: 'var(--gnosi-blue)', color: '#fff', cursor: 'pointer'
        }}
      >
        {currentIconName
          ? <DeferredLucideIcon name={currentIconName} size={24} strokeWidth={2.35} />
          : <IconRenderer icon={value || getAgentIconValue('Brain')} size={24} color="#fff" />}
        <ChevronDown
          size={15}
          aria-hidden="true"
          style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}
        />
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute', top: '56px', right: 0, zIndex: 30,
            width: '326px', padding: '12px', borderRadius: '18px',
            border: '1px solid var(--settings-border)',
            background: 'var(--settings-sidebar-bg)',
            boxShadow: '0 18px 45px rgba(15, 23, 42, 0.2)'
          }}
        >
          <div style={{ position: 'relative', marginBottom: '10px' }}>
            <Search
              size={16}
              aria-hidden="true"
              style={{
                position: 'absolute', left: '11px', top: '50%',
                transform: 'translateY(-50%)', color: 'var(--text-secondary)'
              }}
            />
            <input
              autoFocus
              type="search"
              className="gnosi-input"
              value={searchTerm}
              onChange={event => { setSearchTerm(event.target.value); }}
              placeholder={searchPlaceholder}
              style={{ width: '100%', padding: '9px 10px 9px 36px', fontSize: '0.82rem' }}
            />
          </div>
          <div
            role="listbox"
            aria-label={label}
            style={{
              display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)',
              gap: '6px', maxHeight: '286px', overflowY: 'auto', padding: '2px'
            }}
          >
            {visibleIcons.map(name => {
              const optionValue = getAgentIconValue(name);
              const selected = value === optionValue;
              return (
                <button
                  key={name}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  aria-label={name}
                  title={name}
                  onClick={() => {
                    onChange(optionValue);
                    closePicker();
                  }}
                  style={{
                    width: '42px', height: '42px', padding: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: '11px',
                    border: selected ? '2px solid #fff' : '1px solid var(--gnosi-blue)',
                    background: 'var(--gnosi-blue)',
                    color: '#fff',
                    boxShadow: selected ? '0 0 0 2px var(--gnosi-blue)' : 'none',
                    cursor: 'pointer'
                  }}
                >
                  <DeferredLucideIcon name={name} size={20} strokeWidth={2.35} />
                </button>
              );
            })}
          </div>
          {visibleIcons.length === 0 && (
            <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
              {noResultsLabel}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
