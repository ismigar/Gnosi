import type { Contact } from '../../../shared/api/contacts';
import {
    ContactDetailAdditional,
    ContactDetailMetadata,
} from './ContactDetailAdditional';
import { ContactDetailHeader } from './ContactDetailHeader';
import { ContactDetailInfo } from './ContactDetailInfo';

export interface ContactDetailProps {
    readonly contact?: Contact | null;
    readonly onBack: () => void;
    readonly onDelete: (contactId: string) => unknown;
    readonly onEdit: () => void;
}

export default function ContactDetail({
    contact,
    onBack,
    onDelete,
    onEdit,
}: ContactDetailProps) {
    if (!contact) return null;

    return (
        <div
            className="contact-detail"
            style={{
                padding: '40px',
                maxWidth: '1000px',
                margin: '0 auto',
                color: 'var(--text-primary)',
            }}
        >
            <ContactDetailHeader
                contact={contact}
                onBack={onBack}
                onDelete={onDelete}
                onEdit={onEdit}
            />
            <div
                className="contact-detail__grid"
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                    gap: '32px',
                }}
            >
                <ContactDetailInfo contact={contact} />
                <ContactDetailAdditional contact={contact} />
            </div>
            <ContactDetailMetadata contact={contact} />
        </div>
    );
}
