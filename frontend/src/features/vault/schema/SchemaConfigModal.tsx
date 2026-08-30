import React from 'react';
import { SchemaConfigDialog } from './schema-config/SchemaConfigDialog';
import { useSchemaConfig } from './schema-config/useSchemaConfig';
import type { SchemaConfigModalProps } from './schema-config/types';

export function SchemaConfigModal(props: SchemaConfigModalProps) {
    const model = useSchemaConfig(props);
    return <SchemaConfigDialog model={model} />;
}
