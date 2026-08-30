import { useRef, useState, type SubmitEvent } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useModalKeyboard } from '../../../hooks/useModalKeyboard';

interface GroupDialogProps {
    isOpen: boolean;
    initialName?: string;
    onClose: () => void;
    onSave: (name: string) => Promise<void>;
}

export default function NotebookGroupDialog({ isOpen, initialName = '', onClose, onSave }: GroupDialogProps) {
    const { t } = useTranslation();
    const [name, setName] = useState(initialName);
    const dialogRef = useRef<HTMLDivElement>(null);


    useModalKeyboard({
        isOpen,
        onClose,
        containerRef: dialogRef,
        trapFocus: true,
    });

    if (!isOpen) return null;

    const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        void onSave(trimmed);
        onClose();
    };

    return (
        <div className="notebook-modal-backdrop">
            <div
                ref={dialogRef}
                className="notebook-modal notebook-modal--compact"
                role="dialog"
                aria-modal="true"
                aria-labelledby="notebook-group-dialog-title"
            >
                <header className="notebook-modal__header">
                    <div>
                        <h2 id="notebook-group-dialog-title">
                            {initialName ? t('notebooks.edit_group', 'Edit group') : t('notebooks.create_group', 'Create group')}
                        </h2>
                    </div>
                    <button type="button" className="notebook-icon-button" onClick={onClose} aria-label={t('common.close', 'Close')}>
                        <X size={18} />
                    </button>
                </header>
                <form onSubmit={handleSubmit}>
                    <div className="notebook-modal__body">
                        <label className="notebook-form-label">
                            <span>{t('notebooks.group_name_label', 'Group name')}</span>
                            <input
                                className="notebook-form-input"
                                value={name}
                                onChange={(event) => { setName(event.target.value); }}
                                placeholder={t('notebooks.group_name_placeholder', 'e.g. Primary sources')}
                                autoFocus
                                required
                            />
                        </label>
                    </div>
                    <footer className="notebook-modal__footer">
                        <button type="button" className="btn-gnosi" onClick={onClose}>
                            {t('common.cancel', 'Cancel')}
                        </button>
                        <button type="submit" className="btn-gnosi btn-gnosi-primary" disabled={!name.trim()}>
                            {t('common.save', 'Save')}
                        </button>
                    </footer>
                </form>
            </div>
        </div>
    );
}
