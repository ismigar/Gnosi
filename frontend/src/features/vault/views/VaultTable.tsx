import { TableLayout } from './vault-table/TableLayout';
import type { VaultTableProps } from './vault-table/types';
import { useTableController } from './vault-table/useTableController';

export type { VaultTableProps } from './vault-table/types';

/** Public boundary shared by full-page, list and embedded table views. */
export function VaultTable(props: VaultTableProps) {
  const model = useTableController(props);
  return <TableLayout model={model} />;
}
