/**
 * Dynamic Risk Overlay
 *
 * Not a boolean kill switch — a thermostat that adjusts trading intensity
 * based on portfolio state, volatility, drawdown, and operational health.
 */

import type {
  RiskOverlayDecision,
  RiskOverlayInputs,
  OverlayMode,
  MarketState,
} from '../types.js';

interface OverlayConfig {
  // Drawdown thresholds
  drawdownReducePct: number;     // reduce at this drawdown %
  drawdownHaltPct: number;       // halt new entries
  drawdownFlattenPct: number;    // flatten everything

  // Concentration
  maxConcentrationPct: number;

  // Operational
  maxApiErrorRate: number;       // halt at this error rate
  maxReconDriftUsd: number;      // halt at this recon mismatch
  maxOrderBacklog: number;       // halt at this order count

  // Size and stop adjustments
  reducedSizeMultiplier: number;
  haltSizeMultiplier: number;
  tightenStopBps: number;
  raisedEdgeThresholdBps: number;
}

const DEFAULT_CONFIG: OverlayConfig = {
  drawdownReducePct: 3,
  drawdownHaltPct: 5,
  drawdownFlattenPct: 8,
  maxConcentrationPct: 60,
  maxApiErrorRate: 10,
  maxReconDriftUsd: 50,
  maxOrderBacklog: 5,
  reducedSizeMultiplier: 0.5,
  haltSizeMultiplier: 0,
  tightenStopBps: 30,
  raisedEdgeThresholdBps: 20,
};

export class RiskOverlay {
  private readonly cfg: OverlayConfig;

  constructor(config: Partial<OverlayConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Evaluate current risk conditions and return overlay decision.
   */
  evaluate(inputs: RiskOverlayInputs, marketStates: MarketState[]): RiskOverlayDecision {
    const reasons: string[] = [];
    let mode: OverlayMode = 'normal';
    let sizeMultiplier = 1.0;
    let stopTightenBps = 0;
    let edgeThresholdBoostBps = 0;

    // ── Drawdown checks ──────────────────────────────────────────────────

    if (inputs.drawdownPercent >= this.cfg.drawdownFlattenPct) {
      mode = 'flatten_only';
      sizeMultiplier = 0;
      reasons.push(`Drawdown ${inputs.drawdownPercent.toFixed(1)}% exceeds flatten threshold (${this.cfg.drawdownFlattenPct}%)`);
    } else if (inputs.drawdownPercent >= this.cfg.drawdownHaltPct) {
      mode = 'no_new_entries';
      sizeMultiplier = 0;
      reasons.push(`Drawdown ${inputs.drawdownPercent.toFixed(1)}% exceeds halt threshold (${this.cfg.drawdownHaltPct}%)`);
    } else if (inputs.drawdownPercent >= this.cfg.drawdownReducePct) {
      mode = 'reduced';
      sizeMultiplier = this.cfg.reducedSizeMultiplier;
      stopTightenBps = this.cfg.tightenStopBps;
      edgeThresholdBoostBps = this.cfg.raisedEdgeThresholdBps;
      reasons.push(`Drawdown ${inputs.drawdownPercent.toFixed(1)}% triggers reduced mode`);
    }

    // ── Concentration ────────────────────────────────────────────────────

    if (inputs.concentrationPct > this.cfg.maxConcentrationPct) {
      if (mode === 'normal') mode = 'reduced';
      sizeMultiplier = Math.min(sizeMultiplier, 0.5);
      reasons.push(`Portfolio concentration ${inputs.concentrationPct.toFixed(0)}% exceeds ${this.cfg.maxConcentrationPct}%`);
    }

    // ── Volatility regime shift ──────────────────────────────────────────

    if (inputs.volatilityRegimeShift) {
      if (mode === 'normal') mode = 'reduced';
      sizeMultiplier = Math.min(sizeMultiplier, 0.6);
      stopTightenBps = Math.max(stopTightenBps, 20);
      reasons.push('Volatility regime shift detected');
    }

    // Check if any symbol is in high_vol regime
    const highVolSymbols = marketStates.filter(s => s.regime === 'high_vol');
    if (highVolSymbols.length > 0) {
      sizeMultiplier = Math.min(sizeMultiplier, 0.4);
      stopTightenBps = Math.max(stopTightenBps, 40);
      reasons.push(`High volatility on: ${highVolSymbols.map(s => s.symbol).join(', ')}`);
    }

    // ── Correlation spike ────────────────────────────────────────────────

    if (inputs.correlationSpike) {
      if (mode === 'normal') mode = 'reduced';
      sizeMultiplier = Math.min(sizeMultiplier, 0.5);
      edgeThresholdBoostBps = Math.max(edgeThresholdBoostBps, 15);
      reasons.push('Correlated exposure spike');
    }

    // ── Event risk ───────────────────────────────────────────────────────

    if (inputs.eventRiskWindow) {
      if (mode === 'normal') mode = 'reduced';
      sizeMultiplier = Math.min(sizeMultiplier, 0.3);
      stopTightenBps = Math.max(stopTightenBps, 50);
      edgeThresholdBoostBps = Math.max(edgeThresholdBoostBps, 30);
      reasons.push('Event risk window active');
    }

    // ── Operational risk ─────────────────────────────────────────────────

    const { apiErrorRate, reconDriftUsd, openOrderBacklog } = inputs.operationalRisk;

    if (apiErrorRate > this.cfg.maxApiErrorRate) {
      mode = 'no_new_entries';
      sizeMultiplier = 0;
      reasons.push(`API error rate ${apiErrorRate.toFixed(1)}% exceeds threshold`);
    }

    if (reconDriftUsd > this.cfg.maxReconDriftUsd) {
      if (mode === 'normal' || mode === 'reduced') mode = 'no_new_entries';
      sizeMultiplier = 0;
      reasons.push(`Reconciliation drift $${reconDriftUsd.toFixed(2)} exceeds threshold`);
    }

    if (openOrderBacklog > this.cfg.maxOrderBacklog) {
      if (mode === 'normal') mode = 'reduced';
      sizeMultiplier = Math.min(sizeMultiplier, 0.3);
      reasons.push(`Order backlog (${openOrderBacklog}) exceeds threshold`);
    }

    // ── Low liquidity across symbols ─────────────────────────────────────

    const lowLiqSymbols = marketStates.filter(
      s => s.liquidity.slippageRisk === 'extreme' || s.liquidity.slippageRisk === 'high',
    );
    if (lowLiqSymbols.length > marketStates.length * 0.5 && marketStates.length > 0) {
      sizeMultiplier = Math.min(sizeMultiplier, 0.4);
      reasons.push('Broad low liquidity conditions');
    }

    if (reasons.length === 0) {
      reasons.push('All conditions normal');
    }

    return {
      mode,
      sizeMultiplier: Math.max(0, Math.min(1, sizeMultiplier)),
      stopTightenBps,
      edgeThresholdBoostBps,
      reasons,
      inputs,
      timestamp: Date.now(),
    };
  }
}
