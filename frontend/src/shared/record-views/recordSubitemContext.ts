import { createContext } from 'react';

export const RecordSubitemContext = createContext<((parentId: string) => void) | null>(null);
