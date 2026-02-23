import { useEffect } from 'react';
import {
  Globe,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { useStrategyStore } from '../../../store/strategyStore';
import { StatusBadge } from '../../common';
import type { MarketStateData } from '../../../types/strategy';

const REGIME_LABELS: Record<string, string> = {
  trending_up: 'Trending Up',
  trending_down: 'Trending Down',
  mean_revert: 'Mean Revert',
  high_vol: 'High Volatility',
  low_liquidity: 'Low Liquidity',
  news_risk: 'News Risk',
  breakout: 'Breakout',
};

export function MarketStatePage() {
  const data = useStrategyStore((s) => s.data);
  const fetchData = useStrategyStore((s) => s.fetchData);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <Globe size={40} className="text-muted opacity-40" />
      </div>
    );
  }

  const states = Object.values(data.marketStates);

  return (
    <div className="space-y-5">
      {states.map((ms) => (
        <FullMarketStateCard key={ms.symbol} state={ms} />
      ))}
      {states.length === 0 && (
        <div className="card text-center text-muted py-12">
          <Globe size={40} className="mx-auto mb-3 opacity-40" />
          <p>No market state data available.</p>
        </div>
      )}
    </div>
  );
}

function FullMarketStateCard({ state }: { state: MarketStateData }) {
  const ms = state;

  return (
    <div className="card space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-bold text-text">{ms.symbol}</h3>
          <StatusBadge
            label={REGIME_LABELS[ms.regime] ?? ms.regime}
            variant={ms.regime.includes('vol') || ms.regime.includes('liquidity') ? 'danger' : 'info'}
          />
          <span className="text-xs text-muted">
            {(ms.regimeConfidence * 100).toFixed(0)}% confidence
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {ms.dataIntegrity.healthy ? (
            <CheckCircle size={14} className="text-profit" />
          ) : (
            <XCircle size={14} className="text-loss" />
          )}
          <span className="text-xs text-muted">
            Data: {ms.dataIntegrity.healthy ? 'healthy' : 'degraded'}
          </span>
        </div>
      </div>

      {/* Summary */}
      <p className="text-xs text-muted font-mono bg-bg rounded px-3 py-2">{ms.summary}</p>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Volatility */}
        <MetricBlock title="Volatility">
          <MetricRow label="ATR %" value={`${ms.volatility.atrPercent.toFixed(3)}%`} />
          <MetricRow label="Realized Vol" value={`${(ms.volatility.realizedVol * 100).toFixed(1)}%`} />
          <MetricRow label="Vol-of-Vol" value={ms.volatility.volOfVol.toFixed(4)} />
          <MetricRow label="Percentile" value={`p${(ms.volatility.percentile * 100).toFixed(0)}`} />
          <PercentileBar value={ms.volatility.percentile} />
        </MetricBlock>

        {/* Liquidity */}
        <MetricBlock title="Liquidity">
          <MetricRow label="Spread" value={`${ms.liquidity.spreadPercent.toFixed(4)}%`} />
          <MetricRow label="Depth Proxy" value={ms.liquidity.depthProxy.toFixed(2)} />
          <MetricRow label="Vol Ratio" value={`${ms.liquidity.volumeRatio.toFixed(2)}x`} />
          <MetricRow label="Slippage Risk" value={ms.liquidity.slippageRisk}
            valueColor={ms.liquidity.slippageRisk === 'low' ? '#10b981' :
                        ms.liquidity.slippageRisk === 'extreme' ? '#ef4444' : '#f59e0b'} />
        </MetricBlock>

        {/* Momentum */}
        <MetricBlock title="Momentum">
          <MetricRow label="Direction" value={
            <span className="flex items-center gap-1">
              {ms.momentum.direction === 1 && <><TrendingUp size={12} className="text-profit" /> Up</>}
              {ms.momentum.direction === -1 && <><TrendingDown size={12} className="text-loss" /> Down</>}
              {ms.momentum.direction === 0 && <><Minus size={12} className="text-muted" /> Flat</>}
            </span>
          } />
          <MetricRow label="Strength" value={ms.momentum.strength.toFixed(3)} />
          <MetricRow label="Persistence" value={ms.momentum.persistence.toFixed(3)} />
          <MetricRow label="Slope" value={`${ms.momentum.trendSlope.toFixed(4)}%/candle`} />
        </MetricBlock>

        {/* Data Integrity */}
        <MetricBlock title="Data Integrity">
          <MetricRow label="Stale Feed" value={ms.dataIntegrity.staleFeed ? 'Yes' : 'No'}
            valueColor={ms.dataIntegrity.staleFeed ? '#ef4444' : '#10b981'} />
          <MetricRow label="Missing" value={`${ms.dataIntegrity.missingCandles} candles`}
            valueColor={ms.dataIntegrity.missingCandles > 0 ? '#f59e0b' : '#10b981'} />
          <MetricRow label="Jitter" value={ms.dataIntegrity.exchangeJitter ? 'Detected' : 'Normal'}
            valueColor={ms.dataIntegrity.exchangeJitter ? '#f59e0b' : '#10b981'} />
          <MetricRow label="Last Update" value={`${(ms.dataIntegrity.lastUpdateMs / 1000).toFixed(0)}s ago`} />
        </MetricBlock>
      </div>

      {/* Microstructure Warnings */}
      {ms.microstructure.flags.length > 0 && (
        <div className="border border-warning/20 bg-warning/5 rounded-lg px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={14} className="text-warning" />
            <span className="text-xs font-semibold text-warning">Microstructure Warnings</span>
          </div>
          <ul className="space-y-1">
            {ms.microstructure.flags.map((f, i) => (
              <li key={i} className="text-xs text-warning/80">{f}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MetricBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg rounded-lg p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">{title}</h4>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function MetricRow({ label, value, valueColor }: {
  label: string;
  value: React.ReactNode;
  valueColor?: string;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted">{label}</span>
      <span className="font-mono text-text" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </span>
    </div>
  );
}

function PercentileBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct > 80 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#10b981';

  return (
    <div className="mt-1.5">
      <div className="h-1.5 bg-border rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}
