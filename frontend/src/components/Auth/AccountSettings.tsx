import { useState, type CSSProperties, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, Loader2, Save, UserCog } from 'lucide-react';

import { useAuth } from '../../context/auth-context';
import { toast } from '../../lib/toast';
import { FormGroup, Section } from '../GlobalSettingsModal';

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}

function buttonStyle(disabled: boolean): CSSProperties {
    return {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '10px 18px',
        borderRadius: '12px',
        border: 'none',
        background: 'var(--gnosi-blue, #3b82f6)',
        color: '#fff',
        fontWeight: 600,
        fontSize: '0.9rem',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'opacity 0.2s ease',
    };
}

export default function AccountSettings() {
    const { t } = useTranslation();
    const translateAccount = (key: string, fallback: string): string => (
        t(`settings.account.${key}`, fallback)
    );
    const { user, changePassword, updateProfile } = useAuth();
    const [name, setName] = useState(user?.name ?? '');
    const [email, setEmail] = useState(user?.email ?? '');
    const [profilePassword, setProfilePassword] = useState('');
    const [savingProfile, setSavingProfile] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [repeatPassword, setRepeatPassword] = useState('');
    const [savingPassword, setSavingPassword] = useState(false);

    if (!user) {
        return (
            <Section
                title={translateAccount('title', 'Account')}
                icon={UserCog}
                extra={null}
            >
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
                    {translateAccount(
                        'no_session',
                        'There is no active session: this section is only available with authentication enabled.',
                    )}
                </p>
            </Section>
        );
    }

    const emailChanged = email.trim().toLowerCase() !== user.email.toLowerCase();
    const normalizedName = name.trim();
    const nameChanged = Boolean(normalizedName)
        && normalizedName !== (user.name ?? '');
    const profileDirty = emailChanged || nameChanged;

    const handleSaveProfile = async (
        event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
    ): Promise<void> => {
        event.preventDefault();
        if (!profileDirty || savingProfile) return;
        if (emailChanged && !profilePassword) {
            toast.error(translateAccount(
                'need_current_password_email',
                'Changing the email requires your current password.',
            ));
            return;
        }
        setSavingProfile(true);
        try {
            await updateProfile({
                name: normalizedName || undefined,
                email: emailChanged ? email.trim() : undefined,
                current_password: emailChanged ? profilePassword : undefined,
            });
            setProfilePassword('');
            toast.success(translateAccount('profile_saved', 'Account updated.'));
        } catch (caught: unknown) {
            toast.error(errorMessage(
                caught,
                translateAccount('save_error', 'Could not save the account.'),
            ));
        } finally {
            setSavingProfile(false);
        }
    };

    const handleChangePassword = async (
        event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
    ): Promise<void> => {
        event.preventDefault();
        if (savingPassword) return;
        if (!currentPassword || !newPassword) {
            toast.error(translateAccount(
                'missing_password_fields',
                'Both the current and the new password are required.',
            ));
            return;
        }
        if (newPassword.length < 8) {
            toast.error(translateAccount(
                'password_too_short',
                'The password must be at least 8 characters long.',
            ));
            return;
        }
        if (newPassword !== repeatPassword) {
            toast.error(translateAccount(
                'passwords_dont_match',
                'The new passwords do not match.',
            ));
            return;
        }
        setSavingPassword(true);
        try {
            await changePassword(currentPassword, newPassword);
            setCurrentPassword('');
            setNewPassword('');
            setRepeatPassword('');
            toast.success(translateAccount('password_changed', 'Password changed.'));
        } catch (caught: unknown) {
            toast.error(errorMessage(
                caught,
                translateAccount('password_error', 'Could not change the password.'),
            ));
        } finally {
            setSavingPassword(false);
        }
    };

    return (
        <div className="animate-in">
            <Section
                title={translateAccount('profile_section', 'Account profile')}
                icon={UserCog}
                extra={null}
            >
                <form
                    onSubmit={(event) => void handleSaveProfile(event)}
                    style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}
                >
                    <FormGroup
                        label={translateAccount('name_label', 'Name')}
                        description={undefined}
                    >
                        <input
                            type="text"
                            className="gnosi-input"
                            value={name}
                            onChange={(event) => {
                                setName(event.target.value);
                            }}
                            autoComplete="name"
                        />
                    </FormGroup>
                    <FormGroup
                        label={translateAccount('email_label', 'Email')}
                        description={translateAccount(
                            'email_desc',
                            'This is your sign-in identifier. Changing it requires your current password.',
                        )}
                    >
                        <input
                            type="email"
                            className="gnosi-input"
                            value={email}
                            onChange={(event) => {
                                setEmail(event.target.value);
                            }}
                            autoComplete="email"
                        />
                    </FormGroup>
                    {emailChanged && (
                        <FormGroup
                            label={translateAccount('current_password_label', 'Current password')}
                            description={undefined}
                        >
                            <input
                                type="password"
                                className="gnosi-input"
                                value={profilePassword}
                                onChange={(event) => {
                                    setProfilePassword(event.target.value);
                                }}
                                autoComplete="current-password"
                            />
                        </FormGroup>
                    )}
                    <div>
                        <button
                            type="submit"
                            disabled={!profileDirty || savingProfile}
                            style={buttonStyle(!profileDirty || savingProfile)}
                        >
                            {savingProfile
                                ? <Loader2 size={15} className="animate-spin" />
                                : <Save size={15} />}
                            {translateAccount('save_btn', 'Save changes')}
                        </button>
                    </div>
                </form>
            </Section>

            <Section
                title={translateAccount('password_section', 'Change password')}
                icon={KeyRound}
                extra={null}
            >
                <form
                    onSubmit={(event) => void handleChangePassword(event)}
                    style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}
                >
                    <FormGroup
                        label={translateAccount('current_password_label', 'Current password')}
                        description={undefined}
                    >
                        <input
                            type="password"
                            className="gnosi-input"
                            value={currentPassword}
                            onChange={(event) => {
                                setCurrentPassword(event.target.value);
                            }}
                            autoComplete="current-password"
                        />
                    </FormGroup>
                    <FormGroup
                        label={translateAccount('new_password_label', 'New password')}
                        description={translateAccount(
                            'new_password_desc',
                            'At least 8 characters; accented characters count double towards the 72-byte limit.',
                        )}
                    >
                        <input
                            type="password"
                            className="gnosi-input"
                            value={newPassword}
                            onChange={(event) => {
                                setNewPassword(event.target.value);
                            }}
                            autoComplete="new-password"
                        />
                    </FormGroup>
                    <FormGroup
                        label={translateAccount('repeat_password_label', 'Repeat the new password')}
                        description={undefined}
                    >
                        <input
                            type="password"
                            className="gnosi-input"
                            value={repeatPassword}
                            onChange={(event) => {
                                setRepeatPassword(event.target.value);
                            }}
                            autoComplete="new-password"
                        />
                    </FormGroup>
                    <div>
                        <button
                            type="submit"
                            disabled={savingPassword}
                            style={buttonStyle(savingPassword)}
                        >
                            {savingPassword
                                ? <Loader2 size={15} className="animate-spin" />
                                : <KeyRound size={15} />}
                            {translateAccount('change_password_btn', 'Change password')}
                        </button>
                    </div>
                </form>
            </Section>
        </div>
    );
}
