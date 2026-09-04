import { Bot } from 'lucide-react';
import { DeferredLucideIcon } from '../../../shared/ui/previews/DeferredLucideIcon';

interface Props { readonly icon?: string; readonly size?: number }
export function ChatIcon({ icon, size = 20 }: Props) {
  if (!icon) return <Bot size={size} />;
  if (!icon.startsWith('lucide:')) return <span style={{ fontSize: `${String(size)}px` }}>{icon}</span>;
  const [, name, colorName] = icon.split(':');
  const color = colorName || (name === 'Brain' ? 'white' : 'currentColor');
  return (
    <DeferredLucideIcon
      name={name || ''}
      size={size}
      color={color}
      loadingFallback={<Bot size={size} />}
      invalidFallback={<Bot size={size} />}
    />
  );
}
