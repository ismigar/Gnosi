import { createContext, useContext } from 'react';

import type {
    AuthProfileUpdateInput,
    AuthUser,
} from '../shared/api/auth';

export interface AuthContextValue {
    readonly changePassword: (
        currentPassword: string,
        newPassword: string,
    ) => Promise<void>;
    readonly gnosiMode: string | null;
    readonly loading: boolean;
    readonly login: (email: string, password: string) => Promise<AuthUser>;
    readonly logout: () => Promise<void>;
    readonly refresh: () => Promise<AuthUser | null>;
    readonly register: (
        email: string,
        password: string,
        name?: string,
    ) => Promise<AuthUser>;
    readonly requireAuth: boolean;
    readonly updateProfile: (fields: AuthProfileUpdateInput) => Promise<AuthUser>;
    readonly user: AuthUser | null;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used inside an <AuthProvider>');
    }
    return context;
}
