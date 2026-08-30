import { Bot } from 'lucide-react';
import { DynamicIcon, iconNames } from 'lucide-react/dynamic';

type IconName = typeof iconNames[number];
const names: ReadonlySet<string> = new Set(iconNames);
function isIconName(name: string): name is IconName { return names.has(name); }

interface Props { readonly icon?: string; readonly size?: number }
export function ChatIcon({ icon, size = 20 }: Props) {
  if (!icon) return <Bot size={size} />;
  if (!icon.startsWith('lucide:')) return <span style={{ fontSize: `${String(size)}px` }}>{icon}</span>;
  const [, name, colorName] = icon.split(':');
  const color = colorName || (name === 'Brain' ? 'white' : 'currentColor');
  const normalized = (name || '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  return isIconName(normalized)
    ? <DynamicIcon name={normalized} size={size} color={color} />
    : <Bot size={size} />;
}
