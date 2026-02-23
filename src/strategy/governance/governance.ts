/**
 * Strategy Governance — professional controls for versioned, staged strategy management.
 *
 * Features:
 *   - Versioned strategy configs (semver)
 *   - Feature flags per strategy
 *   - Staged rollout: shadow → paper → small_live → full_live
 *   - Change log: who changed what, when, why
 *   - Kill switch integration
 */

import type {
  StrategyConfig,
  StrategyChangeLog,
  RolloutStage,
} from '../types.js';

const STAGE_ORDER: RolloutStage[] = ['shadow', 'paper', 'small_live', 'full_live'];

export class StrategyGovernance {
  private config: StrategyConfig;
  private changeLog: StrategyChangeLog[] = [];

  constructor(initialConfig?: Partial<StrategyConfig>) {
    this.config = {
      version: initialConfig?.version ?? '1.0.0',
      name: initialConfig?.name ?? 'strategy_engine_v1',
      description: initialConfig?.description ?? 'Professional strategy engine with multi-signal ensemble',
      stage: initialConfig?.stage ?? 'paper',
      featureFlags: initialConfig?.featureFlags ?? {
        alpha_ensemble: true,
        edge_scorer: true,
        risk_overlay: true,
        trade_construction: true,
        llm_explainer: true,
        performance_attribution: true,
        sentiment_tilt: true,
        volatility_breakout: true,
        momentum_divergence: true,
      },
      parameters: initialConfig?.parameters ?? {
        minEdgeBps: 30,
        maxRiskPerTradePct: 2,
        basePositionUsd: 200,
        feeRateBps: 60,
        defaultStopBps: 150,
        defaultTargetBps: 300,
      },
      createdAt: initialConfig?.createdAt ?? Date.now(),
      updatedAt: initialConfig?.updatedAt ?? Date.now(),
      changedBy: initialConfig?.changedBy ?? 'system',
      changeReason: initialConfig?.changeReason ?? 'Initial configuration',
    };
  }

  getConfig(): Readonly<StrategyConfig> {
    return this.config;
  }

  getStage(): RolloutStage {
    return this.config.stage;
  }

  getChangeLog(): ReadonlyArray<StrategyChangeLog> {
    return this.changeLog;
  }

  isFeatureEnabled(flag: string): boolean {
    return this.config.featureFlags[flag] === true;
  }

  /** Check if the strategy is allowed to execute real trades. */
  canExecute(): boolean {
    return this.config.stage === 'small_live' || this.config.stage === 'full_live';
  }

  /** Check if we should only score (shadow mode). */
  isShadowMode(): boolean {
    return this.config.stage === 'shadow';
  }

  /** Get the size multiplier for the current stage. */
  getStageSizeMultiplier(): number {
    switch (this.config.stage) {
      case 'shadow': return 0;
      case 'paper': return 0;
      case 'small_live': return 0.25;  // 25% of normal size
      case 'full_live': return 1.0;
    }
  }

  /**
   * Update a parameter with full audit trail.
   */
  updateParameter(
    key: string,
    value: number | string | boolean,
    changedBy: string,
    reason: string,
  ): void {
    const oldValue = this.config.parameters[key];
    if (oldValue === value) return;

    const diff: StrategyChangeLog['diff'] = {
      [`parameters.${key}`]: { from: oldValue, to: value },
    };

    this.config.parameters[key] = value;
    this.config.updatedAt = Date.now();
    this.config.changedBy = changedBy;
    this.config.changeReason = reason;

    this.changeLog.push({
      version: this.config.version,
      timestamp: Date.now(),
      changedBy,
      reason,
      diff,
    });
  }

  /**
   * Toggle a feature flag with audit trail.
   */
  toggleFeature(flag: string, enabled: boolean, changedBy: string, reason: string): void {
    const oldValue = this.config.featureFlags[flag];
    if (oldValue === enabled) return;

    const diff: StrategyChangeLog['diff'] = {
      [`featureFlags.${flag}`]: { from: oldValue, to: enabled },
    };

    this.config.featureFlags[flag] = enabled;
    this.config.updatedAt = Date.now();
    this.config.changedBy = changedBy;
    this.config.changeReason = reason;

    this.changeLog.push({
      version: this.config.version,
      timestamp: Date.now(),
      changedBy,
      reason,
      diff,
    });
  }

  /**
   * Advance to the next rollout stage.
   * Returns false if already at the highest stage.
   */
  promoteStage(changedBy: string, reason: string): boolean {
    const currentIndex = STAGE_ORDER.indexOf(this.config.stage);
    if (currentIndex >= STAGE_ORDER.length - 1) return false;

    const oldStage = this.config.stage;
    const newStage = STAGE_ORDER[currentIndex + 1]!;

    this.config.stage = newStage;
    this.config.updatedAt = Date.now();
    this.config.changedBy = changedBy;
    this.config.changeReason = reason;

    this.changeLog.push({
      version: this.config.version,
      timestamp: Date.now(),
      changedBy,
      reason,
      diff: { stage: { from: oldStage, to: newStage } },
    });

    return true;
  }

  /**
   * Demote to the previous rollout stage (safety measure).
   */
  demoteStage(changedBy: string, reason: string): boolean {
    const currentIndex = STAGE_ORDER.indexOf(this.config.stage);
    if (currentIndex <= 0) return false;

    const oldStage = this.config.stage;
    const newStage = STAGE_ORDER[currentIndex - 1]!;

    this.config.stage = newStage;
    this.config.updatedAt = Date.now();
    this.config.changedBy = changedBy;
    this.config.changeReason = reason;

    this.changeLog.push({
      version: this.config.version,
      timestamp: Date.now(),
      changedBy,
      reason,
      diff: { stage: { from: oldStage, to: newStage } },
    });

    return true;
  }

  /**
   * Bump the version (minor).
   */
  bumpVersion(changedBy: string, reason: string): string {
    const [major, minor, patch] = this.config.version.split('.').map(Number);
    const newVersion = `${major}.${(minor ?? 0) + 1}.0`;
    const oldVersion = this.config.version;

    this.config.version = newVersion;
    this.config.updatedAt = Date.now();
    this.config.changedBy = changedBy;
    this.config.changeReason = reason;

    this.changeLog.push({
      version: newVersion,
      timestamp: Date.now(),
      changedBy,
      reason,
      diff: { version: { from: oldVersion, to: newVersion } },
    });

    return newVersion;
  }

  /**
   * Export config as JSON (for persistence or API).
   */
  toJSON(): StrategyConfig {
    return { ...this.config };
  }

  /**
   * Load config from JSON.
   */
  static fromJSON(json: StrategyConfig, log?: StrategyChangeLog[]): StrategyGovernance {
    const gov = new StrategyGovernance(json);
    if (log) {
      gov.changeLog = [...log];
    }
    return gov;
  }
}
