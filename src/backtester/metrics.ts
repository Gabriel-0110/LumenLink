/**
 * Backtest performance metrics calculator
 */

export interface BacktestTrade {
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  entryTime: number;
  exitTime: number;
  pnlUsd: number;
  pnlPercent: number;
  positionSizeUsd: number;
  commission: number;
  slippage: number;
  reason: 'stop_loss' | 'take_profit' | 'signal' | 'timeout';
  barsHeld: number;
}

export interface BacktestMetrics {
  // Returns
  totalReturn: number;
  annualizedReturn: number;

  // Risk
  maxDrawdown: number;
  maxDrawdownDuration: number;
  volatility: number;

  // Risk-Adjusted
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  profitFactor: number;

  // Trade Stats
  totalTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  avgRR: number;
  bestTrade: number;
  worstTrade: number;
  avgBarsHeld: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;

  // Exposure
  timeInMarket: number;
  avgPositionSize: number;
}

const RISK_FREE_RATE = 0.045;
const TRADING_DAYS_PER_YEAR = 365;

export function computeMetrics(
  trades: BacktestTrade[],
  equityCurve: Array<{ time: number; equity: number }>,
  initialCapital: number,
  totalBars: number,
): BacktestMetrics {
  const empty: BacktestMetrics = {
    totalReturn: 0, annualizedReturn: 0,
    maxDrawdown: 0, maxDrawdownDuration: 0, volatility: 0,
    sharpeRatio: 0, sortinoRatio: 0, calmarRatio: 0, profitFactor: 0,
    totalTrades: 0, winRate: 0, avgWin: 0, avgLoss: 0, avgRR: 0,
    bestTrade: 0, worstTrade: 0, avgBarsHeld: 0,
    maxConsecutiveWins: 0, maxConsecutiveLosses: 0,
    timeInMarket: 0, avgPositionSize: 0,
  };

  if (equityCurve.length < 2) return empty;

  const finalEquity = equityCurve[equityCurve.length - 1]!.equity;
  const totalReturn = ((finalEquity - initialCapital) / initialCapital) * 100;

  // Duration in years
  const durationMs = equityCurve[equityCurve.length - 1]!.time - equityCurve[0]!.time;
  const durationYears = durationMs / (365.25 * 24 * 60 * 60 * 1000);
  const annualizedReturn = durationYears > 0
    ? (Math.pow(finalEquity / initialCapital, 1 / durationYears) - 1) * 100
    : totalReturn;

  // Daily returns from equity curve
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1]!.equity;
    if (prev > 0) {
      returns.push((equityCurve[i]!.equity - prev) / prev);
    }
  }

  // Volatility (annualized)
  const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length > 1
    ? returns.reduce((sum, r) => sum + (r - meanReturn) ** 2, 0) / (returns.length - 1)
    : 0;
  const dailyVol = Math.sqrt(variance);
  const volatility = dailyVol * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100;

  // Max drawdown
  let peak = equityCurve[0]!.equity;
  let maxDD = 0;
  let maxDDDuration = 0;
  let ddStart = equityCurve[0]!.time;
  for (const point of equityCurve) {
    if (point.equity > peak) {
      peak = point.equity;
      ddStart = point.time;
    }
    const dd = ((peak - point.equity) / peak) * 100;
    if (dd > maxDD) {
      maxDD = dd;
      maxDDDuration = (point.time - ddStart) / (24 * 60 * 60 * 1000);
    }
  }

  // Sharpe
  const dailyRf = RISK_FREE_RATE / TRADING_DAYS_PER_YEAR;
  const excessReturns = returns.map(r => r - dailyRf);
  const meanExcess = excessReturns.length > 0 ? excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length : 0;
  const sharpeRatio = dailyVol > 0 ? (meanExcess / dailyVol) * Math.sqrt(TRADING_DAYS_PER_YEAR) : 0;

  // Sortino
  const downsideReturns = excessReturns.filter(r => r < 0);
  const downsideVar = downsideReturns.length > 0
    ? downsideReturns.reduce((sum, r) => sum + r ** 2, 0) / downsideReturns.length
    : 0;
  const downsideDev = Math.sqrt(downsideVar);
  const sortinoRatio = downsideDev > 0 ? (meanExcess / downsideDev) * Math.sqrt(TRADING_DAYS_PER_YEAR) : 0;

  // Calmar
  const calmarRatio = maxDD > 0 ? annualizedReturn / maxDD : 0;

  // Trade stats
  const wins = trades.filter(t => t.pnlPercent > 0);
  const losses = trades.filter(t => t.pnlPercent <= 0);
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPercent, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnlPercent, 0) / losses.length : 0;
  const avgRR = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0;

  const grossProfit = wins.reduce((s, t) => s + t.pnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  const bestTrade = trades.length > 0 ? Math.max(...trades.map(t => t.pnlPercent)) : 0;
  const worstTrade = trades.length > 0 ? Math.min(...trades.map(t => t.pnlPercent)) : 0;
  const avgBarsHeld = trades.length > 0 ? trades.reduce((s, t) => s + t.barsHeld, 0) / trades.length : 0;

  // Consecutive wins/losses
  let maxConsWins = 0, maxConsLosses = 0, consWins = 0, consLosses = 0;
  for (const t of trades) {
    if (t.pnlPercent > 0) { consWins++; consLosses = 0; maxConsWins = Math.max(maxConsWins, consWins); }
    else { consLosses++; consWins = 0; maxConsLosses = Math.max(maxConsLosses, consLosses); }
  }

  // Exposure
  const barsInMarket = trades.reduce((s, t) => s + t.barsHeld, 0);
  const timeInMarket = totalBars > 0 ? (barsInMarket / totalBars) * 100 : 0;
  const avgPositionSize = trades.length > 0 ? trades.reduce((s, t) => s + t.positionSizeUsd, 0) / trades.length : 0;

  return {
    totalReturn, annualizedReturn,
    maxDrawdown: maxDD, maxDrawdownDuration: maxDDDuration, volatility,
    sharpeRatio, sortinoRatio, calmarRatio, profitFactor,
    totalTrades: trades.length, winRate, avgWin, avgLoss, avgRR,
    bestTrade, worstTrade, avgBarsHeld,
    maxConsecutiveWins: maxConsWins, maxConsecutiveLosses: maxConsLosses,
    timeInMarket, avgPositionSize,
  };
}

export function formatMetrics(metrics: BacktestMetrics): string {
  const lines = [
    '── Returns ──',
    `  Total Return:        ${metrics.totalReturn.toFixed(2)}%`,
    `  Annualized Return:   ${metrics.annualizedReturn.toFixed(2)}%`,
    '── Risk ──',
    `  Max Drawdown:        ${metrics.maxDrawdown.toFixed(2)}%`,
    `  Max DD Duration:     ${metrics.maxDrawdownDuration.toFixed(1)} days`,
    `  Volatility:          ${metrics.volatility.toFixed(2)}%`,
    '── Risk-Adjusted ──',
    `  Sharpe Ratio:        ${metrics.sharpeRatio.toFixed(3)}`,
    `  Sortino Ratio:       ${metrics.sortinoRatio.toFixed(3)}`,
    `  Calmar Ratio:        ${metrics.calmarRatio.toFixed(3)}`,
    `  Profit Factor:       ${metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(3)}`,
    '── Trade Stats ──',
    `  Total Trades:        ${metrics.totalTrades}`,
    `  Win Rate:            ${metrics.winRate.toFixed(1)}%`,
    `  Avg Win:             ${metrics.avgWin.toFixed(2)}%`,
    `  Avg Loss:            ${metrics.avgLoss.toFixed(2)}%`,
    `  Avg R:R:             ${metrics.avgRR.toFixed(2)}`,
    `  Best Trade:          ${metrics.bestTrade.toFixed(2)}%`,
    `  Worst Trade:         ${metrics.worstTrade.toFixed(2)}%`,
    `  Avg Bars Held:       ${metrics.avgBarsHeld.toFixed(1)}`,
    `  Max Consec Wins:     ${metrics.maxConsecutiveWins}`,
    `  Max Consec Losses:   ${metrics.maxConsecutiveLosses}`,
    '── Exposure ──',
    `  Time in Market:      ${metrics.timeInMarket.toFixed(1)}%`,
    `  Avg Position Size:   $${metrics.avgPositionSize.toFixed(2)}`,
  ];
  return lines.join('\n');
}
