/**
 * AccountSettings — "Account" tab of the global settings modal.
 *
 * Lets the authenticated user edit their name/email and rotate their
 * password. The backend requires the current password both to change the
 * email (it is the login identifier) and to change the password itself
 * (see auth_routes.change_password / update_me), so the form only asks for
 * it when one of those two is being touched.
 */
import React, { useState } from 'react';
import { KeyRound, Save, Loader2, UserCog } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { toast } from '../../lib/toast';
import { Section, FormGroup } from '../GlobalSettingsModal';

export default function AccountSettings() {
    const { t } = useTranslation();
    const ta = (k, def) => t('settings.account.' + k, def);
    const { user, changePassword, updateProfile } = useAuth();

    const [name, setName] = useState(user?.name || '');
    const [email, setEmail] = useState(user?.email || '');
    const [profilePassword, setProfilePassword] = useState('');
    const [savingProfile, setSavingProfile] = useState(false);

    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [repeatPassword, setRepeatPassword] = useState('');
    const [savingPassword, setSavingPassword] = useState(false);

    if (!user) {
        return (
            <Section title={ta('title', "Account")} icon={UserCog}>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
                    {ta('no_session', "There is no active session: this section is only available with authentication enabled.")}
                </p>
            </Section>
        );
    }

    const emailChanged = email.trim().toLowerCase() !== (user.email || '').toLowerCase();
    const profileDirty = emailChanged || (name.trim() && name.trim() !== (user.name || ''));

    const handleSaveProfile = async (e) => {
        e.preventDefault();
        if (!profileDirty || savingProfile) return;
        if (emailChanged && !profilePassword) {
            toast.error(ta('need_current_password_email', "Changing the email requires your current password."));
            return;
        }
        setSavingProfile(true);
        try {
            await updateProfile({
                name: name.trim() || undefined,
                email: emailChanged ? email.trim() : undefined,
                current_password: emailChanged ? profilePassword : undefined,
            });
            setProfilePassword('');
            toast.success(ta('profile_saved', "Account updated."));
        } catch (err) {
            toast.error(err.message || ta('save_error', "Could not save the account."));
        } finally {
            setSavingProfile(false);
        }
    };

    const handleChangePassword = async (e) => {
        e.preventDefault();
        if (savingPassword) return;
        if (!currentPassword || !newPassword) {
            toast.error(ta('missing_password_fields', "Both the current and the new password are required."));
            return;
        }
        if (newPassword.length < 8) {
            toast.error(ta('password_too_short', "The password must be at least 8 characters long."));
            return;
        }
        if (newPassword !== repeatPassword) {
            toast.error(ta('passwords_dont_match', "The new passwords do not match."));
            return;
        }
        setSavingPassword(true);
        try {
            await changePassword(currentPassword, newPassword);
            setCurrentPassword('');
            setNewPassword('');
            setRepeatPassword('');
            toast.success(ta('password_changed', "Password changed."));
        } catch (err) {
            toast.error(err.message || ta('password_error', "Could not change the password."));
        } finally {
            setSavingPassword(false);
        }
    };

    const buttonStyle = (disabled) => ({
        display: 'inline-flex', alignItems: 'center', gap: '8px',
        padding: '10px 18px', borderRadius: '12px', border: 'none',
        background: 'var(--gnosi-blue, #3b82f6)', color: '#fff',
        fontWeight: 600, fontSize: '0.9rem',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'opacity 0.2s ease',
    });

    return (
        <div className="animate-in">
            <Section title={ta('profile_section', "Account profile")} icon={UserCog}>
                <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <FormGroup label={ta('name_label', "Name")}>
                        <input
                            type="text"
                            className="gnosi-input"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            autoComplete="name"
                        />
                    </FormGroup>
                    <FormGroup
                        label={ta('email_label', 'Email')}
                        description={ta('email_desc', "This is your sign-in identifier. Changing it requires your current password.")}
                    >
                        <input
                            type="email"
                            className="gnosi-input"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            autoComplete="email"
                        />
                    </FormGroup>
                    {emailChanged && (
                        <FormGroup label={ta('current_password_label', "Current password")}>
                            <input
                                type="password"
                                className="gnosi-input"
                                value={profilePassword}
                                onChange={(e) => setProfilePassword(e.target.value)}
                                autoComplete="current-password"
                            />
                        </FormGroup>
                    )}
                    <div>
                        <button type="submit" disabled={!profileDirty || savingProfile} style={buttonStyle(!profileDirty || savingProfile)}>
                            {savingProfile ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                            {ta('save_btn', "Save changes")}
                        </button>
                    </div>
                </form>
            </Section>

            <Section title={ta('password_section', "Change password")} icon={KeyRound}>
                <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <FormGroup label={ta('current_password_label', "Current password")}>
                        <input
                            type="password"
                            className="gnosi-input"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            autoComplete="current-password"
                        />
                    </FormGroup>
                    <FormGroup
                        label={ta('new_password_label', "New password")}
                        description={ta('new_password_desc', "At least 8 characters; accented characters count double towards the 72-byte limit.")}
                    >
                        <input
                            type="password"
                            className="gnosi-input"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            autoComplete="new-password"
                        />
                    </FormGroup>
                    <FormGroup label={ta('repeat_password_label', "Repeat the new password")}>
                        <input
                            type="password"
                            className="gnosi-input"
                            value={repeatPassword}
                            onChange={(e) => setRepeatPassword(e.target.value)}
                            autoComplete="new-password"
                        />
                    </FormGroup>
                    <div>
                        <button type="submit" disabled={savingPassword} style={buttonStyle(savingPassword)}>
                            {savingPassword ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
                            {ta('change_password_btn', "Change password")}
                        </button>
                    </div>
                </form>
            </Section>
        </div>
    );
}
