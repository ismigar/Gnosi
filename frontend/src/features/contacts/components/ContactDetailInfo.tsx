import { useTranslation } from 'react-i18next';
import { Globe, Mail, MapPin, Phone } from 'lucide-react';

import type { Contact } from '../../../shared/api/contacts';
import { contactFieldItems, type ContactFieldItem } from './contactFormModel';

function ContactValueLabel({ item }: { readonly item: ContactFieldItem }) {
    const { t } = useTranslation();
    const labels: Readonly<Record<string, string>> = {
        home: t('contacts.label_home', "Home"),
        work: t('contacts.label_work', "Work"),
        mobile: t('contacts.label_mobile', "Mobile"),
        other: t('contacts.label_other', "Other"),
    };
    const text = item.label === 'other' && item.customLabel
        ? item.customLabel
        : (labels[item.label] || item.label);
    return <>{text}</>;
}

export interface ContactDetailInfoProps {
    readonly contact: Contact;
}

export function ContactDetailInfo({ contact }: ContactDetailInfoProps) {
    const { t } = useTranslation();
    const emails = contactFieldItems(contact.emails);
    const phones = contactFieldItems(contact.phones);
    const addresses = contactFieldItems(contact.addresses);
    return (
        <div style={{ background: 'var(--bg-secondary)', padding: '28px', borderRadius: '20px', border: '1px solid var(--border-primary)', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
            <h3 style={{ margin: '0 0 24px 0', fontSize: '11px', fontWeight: '700', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.6 }}>
                <Globe size={14} /> {t('contacts.info_section', "Contact Information")}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div style={{ display: 'flex', gap: '14px' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(59,130,246,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gnosi-blue)' }}>
                        <Mail size={16} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '8px', textTransform: 'uppercase', fontWeight: '700', opacity: 0.7 }}>{t('contacts.email_label', "Email")}</span>
                        {emails.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {emails.map((email, index) => (
                                    <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: index === 0 ? 'rgba(255,255,255,0.02)' : 'transparent', padding: index === 0 ? '4px 0' : '0' }}>
                                        <a href={`mailto:${email.value}`} style={{ color: index === 0 ? 'var(--text-primary)' : 'var(--text-secondary)', textDecoration: 'none', fontSize: index === 0 ? '14px' : '13px', fontWeight: index === 0 ? '600' : 'normal' }}>{email.value}</a>
                                        <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px', fontWeight: '700', textTransform: 'uppercase' }}><ContactValueLabel item={email} /></span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <a href={`mailto:${contact.email}`} style={{ color: 'var(--text-primary)', textDecoration: 'none', fontSize: '14px', fontWeight: '600' }}>{contact.email}</a>
                        )}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '14px' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', border: '1px solid var(--border-primary)' }}>
                        <Phone size={16} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '8px', textTransform: 'uppercase', fontWeight: '700', opacity: 0.7 }}>{t('contacts.phone_label', "Phone")}</span>
                        {phones.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {phones.map((phone, index) => (
                                    <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: index === 0 ? 'rgba(255,255,255,0.02)' : 'transparent', padding: index === 0 ? '4px 0' : '0' }}>
                                        <a href={`tel:${phone.value}`} style={{ color: index === 0 ? 'var(--text-primary)' : 'var(--text-secondary)', textDecoration: 'none', fontSize: index === 0 ? '14px' : '13px', fontWeight: index === 0 ? '600' : 'normal' }}>{phone.value}</a>
                                        <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px', fontWeight: '700', textTransform: 'uppercase' }}><ContactValueLabel item={phone} /></span>
                                    </div>
                                ))}
                            </div>
                        ) : contact.phone ? (
                            <a href={`tel:${contact.phone}`} style={{ color: 'var(--text-primary)', textDecoration: 'none', fontSize: '14px', fontWeight: '600' }}>{contact.phone}</a>
                        ) : (
                            <span style={{ color: 'var(--text-tertiary)', fontSize: '13px', fontStyle: 'italic' }}>{t('common.none', "None")}</span>
                        )}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '14px' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(245,158,11,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b' }}>
                        <MapPin size={16} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '8px', textTransform: 'uppercase', fontWeight: '700', opacity: 0.7 }}>{t('contacts.address_label', "Address")}</span>
                        {addresses.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {addresses.map((address, index) => (
                                    <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: '2px', background: index === 0 ? 'rgba(255,255,255,0.02)' : 'transparent', padding: index === 0 ? '4px 0' : '0' }}>
                                        <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', fontWeight: '700', textTransform: 'uppercase' }}><ContactValueLabel item={address} /></span>
                                        <span style={{ color: index === 0 ? 'var(--text-primary)' : 'var(--text-secondary)', fontSize: index === 0 ? '14px' : '13px', fontWeight: index === 0 ? '600' : 'normal' }}>{address.value}</span>
                                    </div>
                                ))}
                            </div>
                        ) : contact.address ? (
                            <span style={{ color: 'var(--text-primary)', fontSize: '14px', fontWeight: '600' }}>{contact.address}</span>
                        ) : (
                            <span style={{ color: 'var(--text-tertiary)', fontSize: '13px', fontStyle: 'italic' }}>{t('common.none', "None")}</span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
