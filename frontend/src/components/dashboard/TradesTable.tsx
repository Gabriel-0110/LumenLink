import { ArrowUp, ArrowDown } from 'lucide-react';
import type { Trade } from '../../types/api';

interface Props {
  trades: Trade[];
}

function fmtUsd(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

function fmtPrice(v: number): string {
  return `$${v.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function TradesTable({ trades }: Props) {
  if (trades.length === 0) {
    return (
      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="bg-surface2 px-3.5 py-2.5 text-left text-[0.68rem] uppercase tracking-wider text-muted font-semibold">
                Time
              </th>
              <th className="bg-surface2 px-3.5 py-2.5 text-left text-[0.68rem] uppercase tracking-wider text-muted font-semibold">
                Symbol
              </th>
              <th className="bg-surface2 px-3.5 py-2.5 text-left text-[0.68rem] uppercase tracking-wider text-muted font-semibold">
                Side
              </th>
              <th className="bg-surface2 px-3.5 py-2.5 text-left text-[0.68rem] uppercase tracking-wider text-muted font-semibold">
                Price
              </th>
              <th className="bg-surface2 px-3.5 py-2.5 text-left text-[0.68rem] uppercase tracking-wider text-muted font-semibold">
                P&L
              </th>
              <th className="bg-surface2 px-3.5 py-2.5 text-left text-[0.68rem] uppercase tracking-wider text-muted font-semibold">
                Conf
              </th>
              <th className="bg-surface2 px-3.5 py-2.5 text-left text-[0.68rem] uppercase tracking-wider text-muted font-semibold">
                Reason
              </th>
              <th className="bg-surface2 px-3.5 py-2.5 text-left text-[0.68rem] uppercase tracking-wider text-muted font-semibold">
                Duration
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={8} className="px-3.5 py-6 text-center text-muted">
                No trades yet
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="bg-surface2 px-3.5 py-2.5 text-left text-[0.68rem] uppercase tracking-wider text-muted font-semibold whitespace-nowrap">
              Time
            </th>
            <th className="bg-surface2 px-3.5 py-2.5 text-left text-[0.68rem] uppercase tracking-wider text-muted font-semibold">
              Symbol
            </th>
            <th className="bg-surface2 px-3.5 py-2.5 text-left text-[0.68rem] uppercase tracking-wider text-muted font-semibold">
              Side
            </th>
            <th className="bg-surface2 px-3.5 py-2.5 text-left text-[0.68rem] uppercase tracking-wider text-muted font-semibold">
              Price
            </th>
            <th className="bg-surface2 px-3.5 py-2.5 text-left text-[0.68rem] uppercase tracking-wider text-muted font-semibold">
              P&L
            </th>
            <th className="bg-surface2 px-3.5 py-2.5 text-left text-[0.68rem] uppercase tracking-wider text-muted font-semibold">
              Conf
            </th>
            <th className="bg-surface2 px-3.5 py-2.5 text-left text-[0.68rem] uppercase tracking-wider text-muted font-semibold">
              Reason
            </th>
            <th className="bg-surface2 px-3.5 py-2.5 text-left text-[0.68rem] uppercase tracking-wider text-muted font-semibold">
              Duration
            </th>
          </tr>
        </thead>
        <tbody>
          {trades.slice(0, 30).map((trade, i) => {
            const isExit = trade.action === 'exit';
            const pnl = trade.realizedPnlUsd;
            const confPct = trade.confidence != null ? (trade.confidence * 100).toFixed(0) + '%' : '--';
            const confColor =
              trade.confidence >= 0.7
                ? '#10b981'
                : trade.confidence >= 0.4
                  ? '#f59e0b'
                  : '#64748b';
            const duration = trade.holdingDurationMs
              ? `${(trade.holdingDurationMs / 3_600_000).toFixed(1)}h`
              : '--';
            const ts = new Date(trade.timestamp).toLocaleString([], {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            });
            return (
              <tr key={`${trade.orderId}-${i}`} className="hover:bg-white/[0.03]">
                <td className="px-3.5 py-2.5 border-t border-border whitespace-nowrap text-xs text-muted">
                  {ts}
                </td>
                <td className="px-3.5 py-2.5 border-t border-border font-semibold">
                  {trade.symbol}
                </td>
                <td className="px-3.5 py-2.5 border-t border-border">
                  {trade.side === 'buy' ? (
                    <span className="pill pill-buy">
                      <ArrowUp size={12} />
                      BUY
                    </span>
                  ) : (
                    <span className="pill pill-sell">
                      <ArrowDown size={12} />
                      SELL
                    </span>
                  )}
                </td>
                <td className="px-3.5 py-2.5 border-t border-border">
                  {fmtPrice(trade.filledPrice)}
                </td>
                <td className="px-3.5 py-2.5 border-t border-border">
                  {isExit && pnl != null ? (
                    <span
                      className="font-semibold"
                      style={{ color: pnl >= 0 ? '#10b981' : '#ef4444' }}
                    >
                      {fmtUsd(pnl)}
                    </span>
                  ) : (
                    <span className="text-muted">open</span>
                  )}
                </td>
                <td className="px-3.5 py-2.5 border-t border-border" style={{ color: confColor }}>
                  {confPct}
                </td>
                <td className="px-3.5 py-2.5 border-t border-border text-muted text-xs whitespace-normal break-words">
                  {trade.reason}
                </td>
                <td className="px-3.5 py-2.5 border-t border-border text-muted">
                  {duration}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
