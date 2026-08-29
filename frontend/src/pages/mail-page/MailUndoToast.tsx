interface MailUndoToastProps {
  readonly label: string;
  readonly onUndo: () => void;
  readonly undoLabel: string;
}


export function MailUndoToast({
  label,
  onUndo,
  undoLabel,
}: MailUndoToastProps) {
  return (
    <span style={{ alignItems: 'center', display: 'flex', gap: '10px' }}>
      <span>{label}</span>
      <button
        type="button"
        onClick={onUndo}
        style={{
          background: 'none',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          fontWeight: 700,
          padding: 0,
          textDecoration: 'underline',
        }}
      >
        {undoLabel}
      </button>
      <span style={{ fontSize: '11px', opacity: 0.5 }}>⌘Z</span>
    </span>
  );
}
