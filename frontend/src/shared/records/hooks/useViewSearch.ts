import { useCallback, useState } from 'react';

export type ViewSearchScope = 'view' | 'table';

export function useViewSearch() {
    const [searchTerm, setTerm] = useState('');
    const [searchScope, setSearchScope] = useState<ViewSearchScope>('view');
    const setSearchTerm = useCallback((value: string) => {
        setTerm(value);
        if (!value.trim()) setSearchScope('view');
    }, []);
    return { searchTerm, setSearchTerm, searchScope, setSearchScope };
}

export function searchesWholeTable(searchTerm: string, scope: ViewSearchScope = 'view'): boolean {
    return scope === 'table' && Boolean(searchTerm.trim());
}
