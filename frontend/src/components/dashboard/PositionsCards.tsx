import { Package } from 'lucide-react';
import type { Position } from '../../types/api';

interface Props {
  positions: Position[];
}

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

export function PositionsCards({ positions }: Props) {
  if (positions.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-card p-6 text-center text-sm text-muted">
        <Package size={24} className="mx-auto mb-2 text-muted/50" />
        No open positions
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {positions.map((pos) => {
        const isProfit = pos.unrealizedPnlUsd >= 0;
        const barPct = Math.min(100, Math.abs(pos.unrealizedPnlPct) * 5); // 20% = full bar

        return (
          <div
            key={pos.symbol}
            className="flex items-center justify-between gap-4 p-4 bg-surface2 rounded-input border border-border flex-wrap"
          >
            {/* Symbol + Quantity */}
            <div className="min-w-[120px]">
              <div className="font-bold text-sm">{pos.symbol}</div>
              <div className="text-xs text-muted">
                {pos.quantity.toFixed(6)} x {fmtPrice(pos.marketPrice)}
              </div>
            </div>

            {/* Entry */}
            <div className="min-w-[80px]">
              <div className="text-[0.72rem] text-muted">entry</div>
              <div className="font-semibold text-sm">{fmtPrice(pos.avgEntryPrice)}</div>
            </div>

            {/* Value */}
            <div className="min-w-[80px]">
              <div className="text-[0.72rem] text-muted">value</div>
              <div className="font-semibold text-sm">
                ${pos.valueUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </div>
            </div>

            {/* P&L bar */}
            <div className="flex-1 min-w-[100px]">
              <div className="text-[0.7rem] text-muted mb-1">unrealized P&L</div>
              <div className="meter-bar">
                <div
                  className="meter-fill"
                  style={{
                    width: `${barPct}%`,
                    background: isProfit ? '#10b981' : '#ef4444',
                  }}
                />
              </div>
            </div>

            {/* P&L value */}
            <div
              className="font-bold text-sm min-w-[120px] text-right"
              style={{ color: isProfit ? '#10b981' : '#ef4444' }}
            >
              {fmtUsd(pos.unrealizedPnlUsd)} ({fmtPct(pos.unrealizedPnlPct)})
            </div>
          </div>
        );
      })}
    </div>
  );
}
