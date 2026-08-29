import {
  Database,
  FileText,
  FolderClosed,
  Hash,
} from 'lucide-react';

import { IconRenderer } from '../IconRenderer';


export interface GlobalSearchResultItem {
  readonly folder: string;
  readonly icon: string;
  readonly id: string;
  readonly sourceDb: string | null;
  readonly tags: readonly string[];
  readonly title: string;
}


interface GlobalSearchResultsProps {
  readonly items: readonly GlobalSearchResultItem[];
  readonly onHover: (index: number) => void;
  readonly onOpen: (index: number) => void;
  readonly selectedIndex: number;
}


function FolderIcon({ folder }: { readonly folder: string }): React.JSX.Element {
  const iconClassName = 'text-[var(--text-tertiary)]';
  if (folder === 'Tasques') {
    return <Hash size={16} className={iconClassName} />;
  }
  if (folder === 'Notes') {
    return <FileText size={16} className={iconClassName} />;
  }
  return <FolderClosed size={16} className={iconClassName} />;
}


export function GlobalSearchResults({
  items,
  onHover,
  onOpen,
  selectedIndex,
}: GlobalSearchResultsProps): React.JSX.Element {
  return (
    <div className="p-2 space-y-1">
      {items.map((item, index) => {
        const isSelected = index === selectedIndex;
        return (
          <button
            key={item.id}
            onClick={() => {
              onOpen(index);
            }}
            onMouseEnter={() => {
              onHover(index);
            }}
            className={`w-full flex items-center justify-between p-3 rounded-lg text-left transition-colors ${isSelected ? 'bg-[var(--gnosi-primary)]/10' : 'hover:bg-[var(--bg-secondary)]'}`}
          >
            <div className="flex items-center gap-3">
              {item.icon ? (
                <IconRenderer
                  icon={item.icon}
                  size={16}
                  className="shrink-0"
                />
              ) : (
                <FolderIcon folder={item.folder} />
              )}
              <div>
                <h3 className={`text-sm font-medium ${isSelected ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-primary)]'}`}>
                  {item.title}
                </h3>
                <div className="flex items-center gap-2 mt-0.5 opacity-70">
                  {item.sourceDb ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
                      <Database size={10} className="shrink-0" />
                      {item.sourceDb}
                    </span>
                  ) : (
                    <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
                      {item.folder}
                    </span>
                  )}
                  {item.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[11px] text-[var(--text-tertiary)]"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
