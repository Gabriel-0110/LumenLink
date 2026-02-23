import { useEffect } from 'react';
import {
  Brain,
  TrendingUp,
  TrendingDown,
  Minus,
  Shield,
  Zap,
  Target,
  AlertTriangle,
} from 'lucide-react';
import { useStrategyStore } from '../../../store/strategyStore';
import { StatCard, StatusBadge } from '../../common';
import type { DecisionRecordData, MarketStateData } from '../../../types/strategy';

const REGIME_COLORS: Record<string, string> = {
  trending_up: '#10b981',
  trending_down: '#ef4444',
  mean_revert: '#6366f1',
  high_vol: '#f59e0b',
  low_liquidity: '#8b5cf6',
  news_risk: '#f97316',
  breakout: '#06b6d4',
};

const OUTCOME_BADGES: Record<string, { variant: 'success' | 'danger' | 'warning' | 'muted'; label: string }> = {
  executed: { variant: 'success', label: 'Executed' },
  blocked: { variant: 'danger', label: 'Blocked' },
  skipped: { variant: 'muted', label: 'Skipped' },
  deferred: { variant: 'warning', label: 'Deferred' },
};

export function StrategyOverview() {
  const data = useStrategyStore((s) => s.data);
  const fetchData = useStrategyStore((s) => s.fetchData);
  const selectDecision = useStrategyStore((s) => s.selectDecision);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Brain size={40} className="mx-auto mb-3 text-muted opacity-40" />
          <p className="text-sm text-muted">Loading strategy engine...</p>
        </div>
      </div>
    );
  }

  const { status, decisions, marketStates } = data;
  const latestDecision = decisions[decisions.length - 1];
  const symbols = Object.keys(marketStates);

  return (
    <div className="space-y-5">
      {/* Market State Panel */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Market State</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {symbols.map((symbol) => {
            const ms = marketStates[symbol]!;
            return <MarketStateCard key={symbol} state={ms} />;
          })}
          {symbols.length === 0 && (
            <div className="col-span-3 card text-center text-muted py-8">
              No market state data yet. Strategy engine initializing...
            </div>
          )}
        </div>
      </section>

      {/* Stats Row */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Today's Trades"
          value={String(status.todayExpectancy.trades)}
          sub={status.todayExpectancy.trades > 0
            ? `${(status.todayExpectancy.winRate * 100).toFixed(0)}% win rate`
            : 'No trades today'}
          accentColor="#6366f1"
          icon={<Zap size={16} />}
        />
        <StatCard
          label="Avg Edge"
          value={`${status.todayExpectancy.avgEdgeBps > 0 ? '+' : ''}${status.todayExpectancy.avgEdgeBps}bps`}
          sub="Expected per trade"
          accentColor={status.todayExpectancy.avgEdgeBps >= 0 ? '#10b981' : '#ef4444'}
          valueColor={status.todayExpectancy.avgEdgeBps >= 0 ? '#10b981' : '#ef4444'}
          icon={<Target size={16} />}
        />
        <StatCard
          label="Strategy Stage"
          value={status.governance.stage.replace('_', ' ')}
          sub={`v${status.governance.version}`}
          accentColor="#8b5cf6"
          icon={<Brain size={16} />}
        />
        <StatCard
          label="Engine Cycles"
          value={String(status.cycleCount)}
          sub={`${status.recentDecisionCount} recent decisions`}
          accentColor="#06b6d4"
          icon={<Shield size={16} />}
        />
      </section>

      {/* Decision Timeline */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
          Recent Decisions
        </h3>
        <div className="space-y-2">
          {decisions.slice(-20).reverse().map((d) => (
            <DecisionRow
              key={d.id}
              decision={d}
              onClick={() => selectDecision(d)}
            />
          ))}
          {decisions.length === 0 && (
            <div className="card text-center text-muted py-8">
              No decisions recorded yet.
            </div>
          )}
        </div>
      </section>

      {/* Explain Drawer */}
      <ExplainDrawer />
    </div>
  );
}

// ── Market State Card ──────────────────────────────────────────────────────

function MarketStateCard({ state }: { state: MarketStateData }) {
  const regimeColor = REGIME_COLORS[state.regime] ?? '#6b7280';

  return (
    <div className="card relative overflow-hidden">
      <div className="stat-accent" style={{ background: regimeColor }} />
      <div className="flex items-start justify-between mb-2">
        <div>
          <span className="text-xs font-bold text-text">{state.symbol}</span>
          <StatusBadge
            label={state.regime.replace(/_/g, ' ')}
            variant={state.regime === 'high_vol' || state.regime === 'low_liquidity' ? 'danger' : 'info'}
          />
        </div>
        <span className="text-xs text-muted">
          {(state.regimeConfidence * 100).toFixed(0)}% conf
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div className="text-muted">Volatility</div>
        <div className="text-right font-mono text-text">
          {state.volatility.atrPercent.toFixed(2)}% ATR
          <span className="text-muted ml-1">(p{(state.volatility.percentile * 100).toFixed(0)})</span>
        </div>

        <div className="text-muted">Spread</div>
        <div className="text-right font-mono text-text">
          {state.liquidity.spreadPercent.toFixed(3)}%
          <span className={`ml-1 ${
            state.liquidity.slippageRisk === 'low' ? 'text-profit' :
            state.liquidity.slippageRisk === 'extreme' ? 'text-loss' : 'text-warning'
          }`}>
            ({state.liquidity.slippageRisk})
          </span>
        </div>

        <div className="text-muted">Momentum</div>
        <div className="text-right font-mono">
          {state.momentum.direction === 1 && <TrendingUp size={12} className="inline text-profit" />}
          {state.momentum.direction === -1 && <TrendingDown size={12} className="inline text-loss" />}
          {state.momentum.direction === 0 && <Minus size={12} className="inline text-muted" />}
          <span className="text-text ml-1">
            str: {state.momentum.strength.toFixed(2)}
          </span>
        </div>

        <div className="text-muted">Data</div>
        <div className="text-right">
          {state.dataIntegrity.healthy ? (
            <span className="text-profit text-xs">Healthy</span>
          ) : (
            <span className="text-loss text-xs">Degraded</span>
          )}
        </div>
      </div>

      {state.microstructure.flags.length > 0 && (
        <div className="mt-2 flex items-start gap-1.5 text-xs text-warning">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>{state.microstructure.flags.join(', ')}</span>
        </div>
      )}
    </div>
  );
}

// ── Decision Row ───────────────────────────────────────────────────────────

function DecisionRow({ decision, onClick }: { decision: DecisionRecordData; onClick: () => void }) {
  const badge = OUTCOME_BADGES[decision.outcome] ?? OUTCOME_BADGES.skipped!;
  const time = new Date(decision.timestamp).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  return (
    <div
      className="card flex items-center gap-4 cursor-pointer hover:bg-white/[0.03] transition-colors"
      onClick={onClick}
    >
      {/* Time */}
      <span className="text-xs text-muted font-mono w-16 shrink-0">{time}</span>

      {/* Symbol */}
      <span className="text-xs font-bold text-text w-20 shrink-0">{decision.symbol}</span>

      {/* Action */}
      <div className="flex items-center gap-1.5 w-16 shrink-0">
        {decision.action === 'buy' && <TrendingUp size={14} className="text-profit" />}
        {decision.action === 'sell' && <TrendingDown size={14} className="text-loss" />}
        {decision.action === 'hold' && <Minus size={14} className="text-muted" />}
        <span className="text-xs uppercase font-semibold">{decision.action}</span>
      </div>

      {/* Outcome */}
      <StatusBadge label={badge.label} variant={badge.variant} />

      {/* Confidence */}
      <span className="text-xs text-muted w-16 shrink-0 text-right">
        {(decision.confidence * 100).toFixed(0)}% conf
      </span>

      {/* Edge */}
      <span className={`text-xs font-mono w-16 shrink-0 text-right ${
        decision.expectedEdgeBps >= 0 ? 'text-profit' : 'text-loss'
      }`}>
        {decision.expectedEdgeBps > 0 ? '+' : ''}{decision.expectedEdgeBps}bps
      </span>

      {/* Explanation summary */}
      <span className="text-xs text-muted flex-1 whitespace-normal break-words">
        {decision.explanation.summary}
      </span>

      {/* Blockers count */}
      {decision.blockers.length > 0 && (
        <span className="text-xs text-warning">
          {decision.blockers.length} blocker{decision.blockers.length > 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}

// ── Explain Drawer ─────────────────────────────────────────────────────────

function ExplainDrawer() {
  const selected = useStrategyStore((s) => s.selectedDecision);
  const drawerOpen = useStrategyStore((s) => s.drawerOpen);
  const toggleDrawer = useStrategyStore((s) => s.toggleDrawer);

  if (!drawerOpen || !selected) return null;

  const d = selected;

  return (
    <div className="fixed inset-y-0 right-0 w-[420px] bg-surface2 border-l border-border shadow-2xl z-50 overflow-y-auto">
      <div className="sticky top-0 bg-surface2 border-b border-border px-5 py-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-text">Decision Detail</h3>
        <button
          onClick={() => toggleDrawer(false)}
          className="text-muted hover:text-text text-sm px-2 py-1"
        >
          Close
        </button>
      </div>

      <div className="p-5 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-muted">{d.id}</span>
          <StatusBadge
            label={OUTCOME_BADGES[d.outcome]?.label ?? d.outcome}
            variant={OUTCOME_BADGES[d.outcome]?.variant ?? 'muted'}
          />
        </div>

        {/* Signal Breakdown */}
        <Section title="Signal Breakdown">
          <div className="space-y-1.5">
            {d.ensemble.votes.map((v) => (
              <div key={v.modelId} className="flex items-center justify-between text-xs">
                <span className="text-muted capitalize">{v.modelId.replace(/_/g, ' ')}</span>
                <div className="flex items-center gap-2">
                  {v.direction === 1 && <TrendingUp size={12} className="text-profit" />}
                  {v.direction === -1 && <TrendingDown size={12} className="text-loss" />}
                  {v.direction === 0 && <Minus size={12} className="text-muted" />}
                  <span className="font-mono">
                    {(v.confidence * 100).toFixed(0)}%
                    <span className="text-muted ml-1">w:{v.weight.toFixed(2)}</span>
                  </span>
                </div>
              </div>
            ))}
            <div className="border-t border-border pt-1.5 flex justify-between text-xs font-semibold">
              <span>Consensus</span>
              <span>{(d.ensemble.consensusLevel * 100).toFixed(0)}%</span>
            </div>
          </div>
        </Section>

        {/* Edge Forecast */}
        <Section title="Edge Forecast">
          <Grid>
            <KV label="P(up)" value={`${(d.forecast.probabilityUp * 100).toFixed(1)}%`} />
            <KV label="P(down)" value={`${(d.forecast.probabilityDown * 100).toFixed(1)}%`} />
            <KV label="E[return]" value={`${d.forecast.expectedReturnBps}bps`}
              valueColor={d.forecast.expectedReturnBps >= 0 ? '#10b981' : '#ef4444'} />
            <KV label="Costs" value={`${d.forecast.costBps}bps`} />
            <KV label="Exceeds costs"
              value={d.forecast.exceedsCosts ? 'Yes' : 'No'}
              valueColor={d.forecast.exceedsCosts ? '#10b981' : '#ef4444'} />
            <KV label="Calibration" value={`${(d.forecast.calibrationScore * 100).toFixed(0)}%`} />
          </Grid>
        </Section>

        {/* Gating Breakdown */}
        <Section title="Gating / Blockers">
          {d.blockers.length > 0 ? (
            <ul className="space-y-1">
              {d.blockers.map((b, i) => (
                <li key={i} className="text-xs text-warning flex items-center gap-1.5">
                  <AlertTriangle size={12} />
                  {b}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-profit">All gates passed</p>
          )}
        </Section>

        {/* Sizing */}
        {d.tradePlan && (
          <Section title="Trade Plan">
            <Grid>
              <KV label="Side" value={d.tradePlan.side.toUpperCase()} />
              <KV label="Size" value={`$${d.tradePlan.sizing.notionalUsd.toFixed(2)}`} />
              <KV label="Risk" value={`${d.tradePlan.sizing.riskPercent.toFixed(2)}%`} />
              <KV label="Stop" value={`${d.tradePlan.exit.stopLossBps}bps`} />
              <KV label="Target" value={`${d.tradePlan.exit.takeProfitBps}bps`} />
              <KV label="R:R" value={`${d.tradePlan.rewardRiskRatio.toFixed(2)}`} />
              <KV label="E[PnL]" value={`$${d.tradePlan.expectedPnlUsd.toFixed(2)}`}
                valueColor={d.tradePlan.expectedPnlUsd >= 0 ? '#10b981' : '#ef4444'} />
            </Grid>
          </Section>
        )}

        {/* Risk Overlay */}
        <Section title="Risk Overlay">
          <Grid>
            <KV label="Mode" value={d.overlay.mode} />
            <KV label="Size mult" value={`${(d.overlay.sizeMultiplier * 100).toFixed(0)}%`} />
            <KV label="Stop tighten" value={`${d.overlay.stopTightenBps}bps`} />
            <KV label="Edge boost" value={`+${d.overlay.edgeThresholdBoostBps}bps`} />
          </Grid>
          {d.overlay.reasons.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {d.overlay.reasons.map((r, i) => (
                <li key={i} className="text-xs text-muted">{r}</li>
              ))}
            </ul>
          )}
        </Section>

        {/* Explanation */}
        <Section title="Explanation">
          <p className="text-xs text-text mb-2">{d.explanation.summary}</p>
          {d.explanation.whyNoTrade && (
            <p className="text-xs text-warning mb-2">{d.explanation.whyNoTrade}</p>
          )}
          <p className="text-xs text-muted">{d.explanation.riskNarrative}</p>
          {d.explanation.whatChanged.length > 0 && (
            <div className="mt-2">
              <span className="text-xs text-muted font-semibold">Changes:</span>
              <ul className="mt-0.5 space-y-0.5">
                {d.explanation.whatChanged.map((c, i) => (
                  <li key={i} className="text-xs text-muted">{c}</li>
                ))}
              </ul>
            </div>
          )}
          {d.explanation.anomalies.length > 0 && (
            <div className="mt-2">
              <span className="text-xs text-warning font-semibold">Anomalies:</span>
              <ul className="mt-0.5 space-y-0.5">
                {d.explanation.anomalies.map((a, i) => (
                  <li key={i} className="text-xs text-warning">{a}</li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">{title}</h4>
      {children}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-1">{children}</div>;
}

function KV({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <>
      <span className="text-xs text-muted">{label}</span>
      <span className="text-xs font-mono text-right" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </span>
    </>
  );
}
