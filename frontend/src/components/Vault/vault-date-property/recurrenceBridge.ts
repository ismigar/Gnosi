import type { ComponentType } from 'react';

import { RecurrenceEditor } from '../RecurrenceEditor';

interface RecurrenceEditorProps {
    readonly onChange: (value: string | null) => void;
    readonly value?: string | null;
}

export const TypedRecurrenceEditor = RecurrenceEditor as unknown as ComponentType<RecurrenceEditorProps>;
