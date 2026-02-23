import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T, index: number) => ReactNode;
  className?: string;
  headerClassName?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T, index: number) => string;
  emptyMessage?: string;
  maxRows?: number;
  onRowClick?: (row: T) => void;
}

const TH =
  'bg-surface2 px-3.5 py-2.5 text-left text-[0.68rem] uppercase tracking-wider text-muted font-semibold whitespace-nowrap';

export function DataTable<T>({
  columns,
  data,
  rowKey,
  emptyMessage = 'No data',
  maxRows,
  onRowClick,
}: DataTableProps<T>) {
  const rows = maxRows ? data.slice(0, maxRows) : data;

  return (
    <div className="table-wrap">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={`${TH} ${col.headerClassName ?? ''}`}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3.5 py-6 text-center text-muted">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                className={`hover:bg-white/[0.03] ${onRowClick ? 'cursor-pointer' : ''}`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-3.5 py-2.5 border-t border-border ${col.className ?? ''}`}
                  >
                    {col.render(row, i)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
