import { createContext } from 'react';

export const ProfileSettingsNavigation = createContext<((section: 'agents' | 'skills', agentId?: string) => void) | undefined>(undefined);
