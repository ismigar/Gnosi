/**
 * LoginPage — pantalla d'entrada per a mode org (equips/cooperatives).
 *
 * Es mostra quan `gnosiMode === 'org'` i no hi ha usuari autenticat. Alterna
 * entre iniciar sessió i registrar-se. El registre també serveix de "claim"
 * d'un membership pre-creat per email (vegeu auth_routes.register), així una
 * cooperativa pot convidar membres abans que es registrin.
 */
import React, { useState } from 'react';
import { LogIn, UserPlus, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { toast } from '../../lib/toast';

export function LoginPage() {
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
            setError('Cal indicar email i contrasenya.');
            return;
        }
        if (isRegister && password.length < 8) {
            setError('La contrasenya ha de tenir almenys 8 caràcters.');
            return;
        }
        setSubmitting(true);
        try {
            if (isRegister) {
                await register(email, password, name);
                toast.success('Compte creat. Benvingut/da a Gnosi!');
            } else {
                await login(email, password);
                toast.success('Sessió iniciada.');
            }
            // No cal navegar: AuthProvider actualitza `user` i App rendaritza l'app.
        } catch (err) {
            setError(err.message || "Error d'autenticació.");
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
                        {isRegister ? 'Crea el teu compte' : 'Benvingut/da a Gnosi'}
                    </h1>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                        {isRegister ? 'Uneix-te al teu espai de treball' : 'Inicia sessió per continuar'}
                    </p>
                </div>

                {isRegister && (
                    <input
                        className="gnosi-input"
                        type="text"
                        placeholder="Nom (opcional)"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="name"
                    />
                )}

                <input
                    className="gnosi-input"
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                />

                <input
                    className="gnosi-input"
                    type="password"
                    placeholder="Contrasenya"
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
                    {submitting ? 'Processant…' : isRegister ? 'Crear compte' : 'Entrar'}
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
                    {isRegister ? 'Ja tens compte? Inicia sessió' : 'No tens compte? Registra-t’hi'}
                </button>
            </form>
        </div>
    );
}

export default LoginPage;
