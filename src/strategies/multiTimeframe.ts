import { EMA, ADX } from 'technicalindicators';
import type { Candle } from '../core/types.js';

export interface TimeframeSignal {
  timeframe: string;       // '1h', '4h', '1d'
  trend: 'bullish' | 'bearish' | 'neutral';
  strength: number;        // 0-1
  reason: string;
}

export interface MTFResult {
  aligned: boolean;         // Are all timeframes agreeing?
  direction: 'bullish' | 'bearish' | 'neutral';
  signals: TimeframeSignal[];
  confidenceBoost: number;  // 0 to 0.2 bonus confidence when aligned
}

export class MultiTimeframeAnalyzer {
  // Analyze trend on a single timeframe using EMA stack + ADX
  analyzeTrend(candles: Candle[], timeframe: string): TimeframeSignal {
    if (candles.length < 200) {
      return {
        timeframe,
        trend: 'neutral',
        strength: 0,
        reason: 'Insufficient data for MTF analysis'
      };
    }

    try {
      const closes = candles.map(c => c.close);
      const highs = candles.map(c => c.high);
      const lows = candles.map(c => c.low);
      const currentPrice = closes[closes.length - 1]!;

      // Calculate EMAs
      const ema9 = EMA.calculate({ values: closes, period: 9 });
      const ema21 = EMA.calculate({ values: closes, period: 21 });
      const ema50 = EMA.calculate({ values: closes, period: 50 });
      const ema200 = EMA.calculate({ values: closes, period: 200 });

      const latestEma9 = ema9[ema9.length - 1];
      const latestEma21 = ema21[ema21.length - 1];
      const latestEma50 = ema50[ema50.length - 1];
      const latestEma200 = ema200[ema200.length - 1];

      if (!latestEma9 || !latestEma21 || !latestEma50 || !latestEma200) {
        return {
          timeframe,
          trend: 'neutral',
          strength: 0,
          reason: 'EMA calculation failed'
        };
      }

      // Calculate ADX for trend strength
      const adxResults = ADX.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: 14
      });
      const latestAdx = adxResults[adxResults.length - 1];
      
      let trendStrength = 0.5; // Default neutral strength
      if (latestAdx) {
        // Normalize ADX (0-100) to 0-1 scale
        trendStrength = Math.min(1, latestAdx.adx / 50); // ADX 50+ = max strength
      }

      // Determine trend direction using EMA stack
      let trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
      let reason = '';

      // Check EMA alignment
      const bullishStack = latestEma9 > latestEma21 && latestEma21 > latestEma50;
      const bearishStack = latestEma9 < latestEma21 && latestEma21 < latestEma50;
      
      // Price vs EMA 200 for macro filter
      const aboveEma200 = currentPrice > latestEma200;

      if (bullishStack && aboveEma200) {
        trend = 'bullish';
        reason = `Bullish EMA stack + above EMA200 (${timeframe})`;
      } else if (bearishStack && !aboveEma200) {
        trend = 'bearish';
        reason = `Bearish EMA stack + below EMA200 (${timeframe})`;
      } else if (bullishStack) {
        trend = 'bullish';
        reason = `Bullish EMA stack but below EMA200 (${timeframe})`;
        trendStrength *= 0.7; // Reduce strength due to macro conflict
      } else if (bearishStack) {
        trend = 'bearish';
        reason = `Bearish EMA stack but above EMA200 (${timeframe})`;
        trendStrength *= 0.7; // Reduce strength due to macro conflict
      } else if (aboveEma200) {
        trend = 'bullish';
        reason = `Above EMA200 but mixed EMA stack (${timeframe})`;
        trendStrength *= 0.5; // Weak trend
      } else {
        trend = 'bearish';
        reason = `Below EMA200 but mixed EMA stack (${timeframe})`;
        trendStrength *= 0.5; // Weak trend
      }

      // Add ADX context to reason
      if (latestAdx) {
        const adxLabel = latestAdx.adx > 25 ? 'strong' : 'weak';
        reason += ` [ADX: ${latestAdx.adx.toFixed(0)} - ${adxLabel} trend]`;
      }

      return {
        timeframe,
        trend,
        strength: Math.max(0, Math.min(1, trendStrength)),
        reason
      };

    } catch (error) {
      return {
        timeframe,
        trend: 'neutral',
        strength: 0,
        reason: `MTF analysis error: ${String(error)}`
      };
    }
  }

  // Combine multiple timeframe analyses
  analyze(timeframeCandles: Map<string, Candle[]>): MTFResult {
    const signals: TimeframeSignal[] = [];
    
    // Analyze each timeframe
    for (const [timeframe, candles] of timeframeCandles.entries()) {
      const signal = this.analyzeTrend(candles, timeframe);
      signals.push(signal);
    }

    if (signals.length === 0) {
      return {
        aligned: false,
        direction: 'neutral',
        signals: [],
        confidenceBoost: 0
      };
    }

    // Determine overall direction with timeframe priority: 1d > 4h > 1h
    const timeframePriority = { '1d': 3, '4h': 2, '1h': 1 };
    const sortedSignals = signals.sort((a, b) => {
      const priorityA = timeframePriority[a.timeframe as keyof typeof timeframePriority] || 0;
      const priorityB = timeframePriority[b.timeframe as keyof typeof timeframePriority] || 0;
      return priorityB - priorityA; // Higher priority first
    });

    // Use highest priority timeframe as base direction
    const primarySignal = sortedSignals[0]!;
    let overallDirection = primarySignal.trend;

    // Check for alignment
    const bullishSignals = signals.filter(s => s.trend === 'bullish');
    const bearishSignals = signals.filter(s => s.trend === 'bearish');
    const neutralSignals = signals.filter(s => s.trend === 'neutral');

    let aligned = false;
    let confidenceBoost = 0;

    if (bullishSignals.length === signals.length) {
      // All bullish
      aligned = true;
      overallDirection = 'bullish';
      confidenceBoost = 0.15;
    } else if (bearishSignals.length === signals.length) {
      // All bearish
      aligned = true;
      overallDirection = 'bearish';
      confidenceBoost = 0.15;
    } else {
      // Mixed signals
      aligned = false;
      
      // If higher timeframe disagrees with lower ones, reduce confidence
      if (signals.length >= 2) {
        const dailySignal = signals.find(s => s.timeframe === '1d');
        const hourlySignals = signals.filter(s => s.timeframe === '1h' || s.timeframe === '4h');
        
        if (dailySignal && hourlySignals.length > 0) {
          const hourlyAgree = hourlySignals.every(s => s.trend === hourlySignals[0]!.trend);
          
          if (hourlyAgree && dailySignal.trend !== hourlySignals[0]!.trend && 
              dailySignal.trend !== 'neutral' && hourlySignals[0]!.trend !== 'neutral') {
            // Higher timeframe disagrees with aligned lower timeframes
            confidenceBoost = -0.1; // Negative boost (reduce confidence)
            // But still use higher timeframe direction
            overallDirection = dailySignal.trend;
          }
        }
      }
    }

    return {
      aligned,
      direction: overallDirection,
      signals: sortedSignals,
      confidenceBoost: Math.max(-0.2, Math.min(0.2, confidenceBoost))
    };
  }
}