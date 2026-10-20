import { useTranslation } from 'react-i18next';
import type { QueuedPrompt } from './promptQueue';
export function PromptQueue({ items, error, update, remove, move, resume }: {
  items: readonly QueuedPrompt[]; error: boolean;
  update: (id: string, text: string) => void; remove: (id: string) => void;
  move: (id: string, delta: number) => void; resume: () => void;
}) {
  const { t } = useTranslation();
  if (!items.length && !error) return null;
  return <details open style={{ padding: '8px 12px', borderTop: '1px solid var(--border-primary)', maxHeight: 200, overflowY: 'auto' }}>
    <summary>{t('chat.queue.title', 'Next turns')} ({items.length})</summary>
    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{t('chat.queue.help', 'Queued instructions run after the current response. They do not change a running turn.')}</p>
    {error && <p role="alert">{t('chat.queue.storage_error', 'The queue could not be saved. Your draft has been kept.')}</p>}
    {items.some(item => item.status === 'paused' || item.status === 'uncertain') && <><p role="status">{t('chat.queue.paused', 'Queue paused. Review the conversation before continuing: a previous turn may already have been delivered.')}</p><button className="btn-gnosi btn-gnosi-secondary" type="button" onClick={resume}>{t('chat.queue.resume', 'Continue pending turns')}</button></>}
    {items.map((item, index) => <div key={item.id} style={{ marginTop: 8 }}>
      {item.status === 'uncertain' && <p role="status">{t('chat.queue.uncertain', 'Delivery unknown. This turn will not be sent again; review or remove it.')}</p>}
      <textarea aria-label={t('chat.queue.edit', 'Edit queued instruction')} value={item.text} disabled={item.status === 'sending'} onChange={event => { update(item.id, event.target.value); }} style={{ width: '100%', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }} />
      {item.attachments.map(attachment => <span key={attachment.id}> 📎 {attachment.name}</span>)}
      <div><button type="button" disabled={index === 0 || item.status === 'sending'} onClick={() => { move(item.id, -1); }} aria-label={t('chat.queue.up', 'Move earlier')}>↑</button><button type="button" disabled={index === items.length - 1 || item.status === 'sending'} onClick={() => { move(item.id, 1); }} aria-label={t('chat.queue.down', 'Move later')}>↓</button><button type="button" disabled={item.status === 'sending'} onClick={() => { remove(item.id); }}>{t('chat.queue.remove', 'Remove')}</button></div>
    </div>)}
  </details>;
}
