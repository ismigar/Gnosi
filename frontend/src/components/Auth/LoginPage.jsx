/**
 * LoginPage — entry screen when there is no authenticated user.
 *
 * Shown in org mode, and in personal mode when the backend enforces auth
 * (GNOSI_REQUIRE_AUTH, surfaced as `require_auth` by /api/health). Toggles
 * between signing in and signing up. Signing up also serves as a "claim"
 * of a membership pre-created by email (see auth_routes.register), so a
 * cooperative can invite members before they register.
 */
import React, { useState } from 'react';
import { LogIn, UserPlus, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/auth-context';
import { toast } from '../../lib/toast';

export function LoginPage() {
    const { t } = useTranslation();
    const { login, register } = useAuth();
    const [mode, setMode] = useState('login'); // 'login' | 'register'
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    const isRegister = mode === 'register';

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (!email || !password) {
            setError(t('auth.missing_fields', "Email and password are required."));
            return;
        }
        if (isRegister && password.length < 8) {
            setError(t('auth.password_too_short', "The password must be at least 8 characters long."));
            return;
        }
        setSubmitting(true);
        try {
            if (isRegister) {
                await register(email, password, name);
                toast.success(t('auth.register_success', "Account created. Welcome to Gnosi!"));
            } else {
                await login(email, password);
                toast.success(t('auth.login_success', "Signed in."));
            }
            // No need to navigate: AuthProvider updates `user` and App renders the app.
        } catch (err) {
            setError(err.message || t('auth.auth_error', "Authentication error."));
        } finally {
            setSubmitting(false);
        }
    };

    const toggleMode = () => {
        setMode(isRegister ? 'login' : 'register');
        setError('');
    };

    return (
        <div
            style={{
                minHeight: '100vh',
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '24px',
                background: 'var(--bg-secondary)',
            }}
        >
            <form
                onSubmit={handleSubmit}
                style={{
                    width: '100%',
                    maxWidth: '380px',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--settings-border)',
                    borderRadius: '16px',
                    padding: '32px',
                    boxShadow: '0 8px 30px rgba(0,0,0,0.08)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '14px',
                }}
            >
                <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                    <div
                        style={{
                            width: '48px',
                            height: '48px',
                            margin: '0 auto 12px',
                            borderRadius: '12px',
                            background: 'var(--gnosi-blue, #3b82f6)',
                            color: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontFamily: 'Outfit, sans-serif',
                            fontWeight: 700,
                            fontSize: '24px',
                        }}
                    >
                        G
                    </div>
                    <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                        {isRegister ? t('auth.register_title', "Create your account") : t('auth.login_title', "Welcome to Gnosi")}
                    </h1>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                        {isRegister ? t('auth.register_subtitle', "Join your workspace") : t('auth.login_subtitle', "Sign in to continue")}
                    </p>
                </div>

                {isRegister && (
                    <input
                        className="gnosi-input"
                        type="text"
                        placeholder={t('auth.name_placeholder', "Name (optional)")}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="name"
                    />
                )}

                <input
                    className="gnosi-input"
                    type="email"
                    placeholder={t('auth.email_placeholder', 'Email')}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                />

                <input
                    className="gnosi-input"
                    type="password"
                    placeholder={t('auth.password_placeholder', "Password")}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={isRegister ? 'new-password' : 'current-password'}
                    required
                />

                {error && (
                    <div
                        style={{
                            fontSize: '13px',
                            color: '#dc2626',
                            background: 'rgba(220,38,38,0.08)',
                            border: '1px solid rgba(220,38,38,0.2)',
                            borderRadius: '8px',
                            padding: '8px 12px',
                        }}
                    >
                        {error}
                    </div>
                )}

                <button
                    type="submit"
                    disabled={submitting}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        padding: '12px',
                        borderRadius: '12px',
                        border: 'none',
                        background: 'var(--gnosi-blue, #3b82f6)',
                        color: '#fff',
                        fontWeight: 600,
                        fontSize: '14px',
                        cursor: submitting ? 'default' : 'pointer',
                        opacity: submitting ? 0.7 : 1,
                        transition: 'opacity 0.2s ease',
                    }}
                >
                    {submitting ? (
                        <Loader2 size={16} className="animate-spin" />
                    ) : isRegister ? (
                        <UserPlus size={16} />
                    ) : (
                        <LogIn size={16} />
                    )}
                    {submitting ? t('auth.processing', "Processing…") : isRegister ? t('auth.create_account_btn', "Create account") : t('auth.enter_btn', "Sign in")}
                </button>

                <button
                    type="button"
                    onClick={toggleMode}
                    style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-secondary)',
                        fontSize: '13px',
                        cursor: 'pointer',
                        padding: '4px',
                    }}
                >
                    {isRegister ? t('auth.switch_to_login', "Already have an account? Sign in") : t('auth.switch_to_register', "Don't have an account? Sign up")}
                </button>
            </form>
        </div>
    );
}

export default LoginPage;
