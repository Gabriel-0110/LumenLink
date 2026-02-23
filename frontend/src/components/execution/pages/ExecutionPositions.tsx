import { useState } from 'react';
import { Layers } from 'lucide-react';
import { useDashboardStore } from '../../../store/dashboardStore';
import { DataTable, FilterBar, EmptyState } from '../../common';
import type { Column } from '../../common';
import type { Position } from '../../../types/api';

function fmtUsd(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}$${Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtPrice(v: number): string {
  return `$${v.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

const DUST_THRESHOLD = 1; // $1 value = dust

type PositionFilter = 'all' | 'open' | 'dust';

export function ExecutionPositions() {
  const data = useDashboardStore((s) => s.data);
  const [filter, setFilter] = useState<PositionFilter>('all');

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 rounded-full border-2 border-brand border-t-transparent animate-spin" />
      </div>
    );
  }

  const allPositions = data.positions;
  const openPositions = allPositions.filter((p) => p.valueUsd > DUST_THRESHOLD);
  const dustPositions = allPositions.filter((p) => p.valueUsd <= DUST_THRESHOLD);

  const filtered =
    filter === 'open'
      ? openPositions
      : filter === 'dust'
        ? dustPositions
        : allPositions;

  const filterOptions = [
    { label: 'All', value: 'all', count: allPositions.length },
    { label: 'Open', value: 'open', count: openPositions.length },
    { label: 'Dust', value: 'dust', count: dustPositions.length },
  ];

  const columns: Column<Position>[] = [
    {
      key: 'symbol',
      header: 'Symbol',
      render: (row) => <span className="font-bold">{row.symbol}</span>,
    },
    {
      key: 'qty',
      header: 'Quantity',
      render: (row) => row.quantity.toFixed(6),
      className: 'text-right font-mono text-xs',
    },
    {
      key: 'entry',
      header: 'Avg Entry',
      render: (row) => fmtPrice(row.avgEntryPrice),
      className: 'text-right',
    },
    {
      key: 'mark',
      header: 'Mark Price',
      render: (row) => fmtPrice(row.marketPrice),
      className: 'text-right',
    },
    {
      key: 'value',
      header: 'Value',
      render: (row) => fmtPrice(row.valueUsd),
      className: 'text-right',
    },
    {
      key: 'pnlUsd',
      header: 'Unrealized $',
      render: (row) => (
        <span
          className="font-semibold"
          style={{ color: row.unrealizedPnlUsd >= 0 ? '#10b981' : '#ef4444' }}
        >
          {fmtUsd(row.unrealizedPnlUsd)}
        </span>
      ),
      className: 'text-right',
    },
    {
      key: 'pnlPct',
      header: 'Unrealized %',
      render: (row) => (
        <span style={{ color: row.unrealizedPnlPct >= 0 ? '#10b981' : '#ef4444' }}>
          {fmtPct(row.unrealizedPnlPct)}
        </span>
      ),
      className: 'text-right',
    },
    {
      key: 'pnlBar',
      header: 'P&L',
      render: (row) => {
        const isProfit = row.unrealizedPnlUsd >= 0;
        const barPct = Math.min(100, Math.abs(row.unrealizedPnlPct) * 5);
        return (
          <div className="w-20">
            <div className="meter-bar h-1.5">
              <div
                className="meter-fill"
                style={{
                  width: `${barPct}%`,
                  background: isProfit ? '#10b981' : '#ef4444',
                }}
              />
            </div>
          </div>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold flex items-center gap-2">
          <Layers size={18} className="text-brand" />
          Positions
        </h2>
        <FilterBar options={filterOptions} selected={filter} onChange={(v) => setFilter(v as PositionFilter)} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No positions" description={filter === 'dust' ? 'No dust positions' : 'No open positions'} />
      ) : (
        <DataTable
          columns={columns}
          data={filtered}
          rowKey={(row) => row.symbol}
          emptyMessage="No positions"
        />
      )}
    </div>
  );
}
