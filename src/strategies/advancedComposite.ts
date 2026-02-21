import {
  EMA,
  MACD,
  RSI,
  ADX,
  ATR,
  BollingerBands,
  StochasticRSI,
  OBV,
  MFI,
  CCI,
  WilliamsR,
} from 'technicalindicators';
import type { Candle, Signal } from '../core/types.js';
import type { Strategy, StrategyContext } from './interface.js';
import type { MTFResult } from './multiTimeframe.js';

interface IndicatorSnapshot {
  ema9: number;
  ema21: number;
  ema50: number;
  ema200: number;
  rsi: number;
  macdLine: number;
  macdSignal: number;
  macdHist: number;
  adx: number;
  pdi: number;
  mdi: number;
  atr: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  stochK: number;
  stochD: number;
  vwap: number;
  obv: number;
  mfi: number;
  cci: number;
  williamsR: number;
  price: number;
  volume: number;
  avgVolume20: number;
}

export class AdvancedCompositeStrategy implements Strategy {
  readonly name = 'advanced_composite';

  onCandle(_candle: Candle, context: StrategyContext): Signal {
    const { candles, mtfResult } = context;

    if (candles.length < 210) {
      return { action: 'HOLD', confidence: 0.1, reason: 'Insufficient data for advanced composite (need 210+ candles)' };
    }

    const snap = this.computeIndicators(candles);
    if (!snap) {
      return { action: 'HOLD', confidence: 0.1, reason: 'Indicator computation failed' };
    }

    const { score, reasons } = this.scoreSetup(snap, candles, mtfResult);

    const absScore = Math.abs(score);
    if (absScore < 2) {
      return { action: 'HOLD', confidence: 0.3, reason: `Score ${score.toFixed(1)} (neutral): ${reasons.join('; ')}` };
    }

    // Apply MTF confidence adjustment
    let baseConfidence = Math.min(0.95, 0.5 + absScore / 20);
    if (mtfResult && mtfResult.confidenceBoost !== 0) {
      baseConfidence = Math.max(0.1, Math.min(0.95, baseConfidence + mtfResult.confidenceBoost));
    }

    return {
      action: score > 0 ? 'BUY' : 'SELL',
      confidence: baseConfidence,
      reason: `Score ${score.toFixed(1)}: ${reasons.join('; ')}`,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Indicator computation                                              */
  /* ------------------------------------------------------------------ */

  private computeIndicators(candles: Candle[]): IndicatorSnapshot | null {
    try {
      const closes = candles.map((c) => c.close);
      const highs = candles.map((c) => c.high);
      const lows = candles.map((c) => c.low);
      const volumes = candles.map((c) => c.volume);

      const last = <T>(arr: T[]): T | undefined => arr[arr.length - 1];
      const prev = <T>(arr: T[]): T | undefined => arr[arr.length - 2];

      // EMAs
      const ema9 = last(EMA.calculate({ values: closes, period: 9 }));
      const ema21 = last(EMA.calculate({ values: closes, period: 21 }));
      const ema50 = last(EMA.calculate({ values: closes, period: 50 }));
      const ema200 = last(EMA.calculate({ values: closes, period: 200 }));

      // RSI
      const rsi = last(RSI.calculate({ values: closes, period: 14 }));

      // MACD
      const macdArr = MACD.calculate({
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: true,
        SimpleMASignal: true,
      });
      const macdLatest = last(macdArr);

      // ADX
      const adxArr = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
      const adxLatest = last(adxArr);

      // ATR
      const atr = last(ATR.calculate({ high: highs, low: lows, close: closes, period: 14 }));

      // Bollinger Bands
      const bbArr = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
      const bbLatest = last(bbArr);

      // Stochastic RSI
      const stochArr = StochasticRSI.calculate({
        values: closes,
        rsiPeriod: 14,
        stochasticPeriod: 14,
        kPeriod: 3,
        dPeriod: 3,
      });
      const stochLatest = last(stochArr);

      // OBV
      const obv = last(OBV.calculate({ close: closes, volume: volumes }));

      // MFI
      const mfi = last(MFI.calculate({ high: highs, low: lows, close: closes, volume: volumes, period: 14 }));

      // CCI
      const cci = last(CCI.calculate({ high: highs, low: lows, close: closes, period: 20 }));

      // Williams %R
      const wr = last(WilliamsR.calculate({ high: highs, low: lows, close: closes, period: 14 }));

      // VWAP (manual, last 50 candles)
      const vwap = this.calcVWAP(candles.slice(-50));

      // Avg volume 20
      const vol20 = volumes.slice(-20);
      const avgVolume20 = vol20.reduce((s, v) => s + v, 0) / vol20.length;

      if (
        ema9 == null || ema21 == null || ema50 == null || ema200 == null ||
        rsi == null || macdLatest == null || adxLatest == null || atr == null ||
        bbLatest == null || stochLatest == null || obv == null || mfi == null ||
        cci == null || wr == null
      ) {
        return null;
      }

      const price = candles[candles.length - 1]!.close;
      const volume = candles[candles.length - 1]!.volume;

      return {
        ema9: ema9 ?? 0,
        ema21: ema21 ?? 0,
        ema50: ema50 ?? 0,
        ema200: ema200 ?? 0,
        rsi: rsi ?? 50,
        macdLine: macdLatest.MACD ?? 0,
        macdSignal: macdLatest.signal ?? 0,
        macdHist: macdLatest.histogram ?? 0,
        adx: adxLatest.adx ?? 25,
        pdi: adxLatest.pdi ?? 25,
        mdi: adxLatest.mdi ?? 25,
        atr: atr ?? 0,
        bbUpper: bbLatest.upper ?? price,
        bbMiddle: bbLatest.middle ?? price,
        bbLower: bbLatest.lower ?? price,
        stochK: stochLatest.k ?? 50,
        stochD: stochLatest.d ?? 50,
        vwap: vwap ?? price,
        obv: obv ?? 0,
        mfi: mfi ?? 50,
        cci: cci ?? 0,
        williamsR: wr ?? -50,
        price,
        volume,
        avgVolume20,
      };
    } catch {
      return null;
    }
  }

  private calcVWAP(candles: Candle[]): number {
    let cumVP = 0;
    let cumV = 0;
    for (const c of candles) {
      const tp = (c.high + c.low + c.close) / 3;
      cumVP += tp * c.volume;
      cumV += c.volume;
    }
    return cumV > 0 ? cumVP / cumV : 0;
  }

  /* ------------------------------------------------------------------ */
  /*  Scoring engine                                                     */
  /* ------------------------------------------------------------------ */

  private scoreSetup(s: IndicatorSnapshot, candles: Candle[], mtfResult?: MTFResult): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    // --- EMA stack (±2) ---
    if (s.ema9 > s.ema21 && s.ema21 > s.ema50) {
      score += 2; reasons.push('Bullish EMA stack');
    } else if (s.ema9 < s.ema21 && s.ema21 < s.ema50) {
      score -= 2; reasons.push('Bearish EMA stack');
    }

    // --- Price vs EMA 200 (±1) ---
    if (s.price > s.ema200) { score += 1; reasons.push('Above EMA200'); }
    else { score -= 1; reasons.push('Below EMA200'); }

    // --- RSI (±2 extreme, ±1 approaching) ---
    if (s.rsi <= 30) { score += 2; reasons.push(`RSI oversold (${s.rsi.toFixed(0)})`); }
    else if (s.rsi >= 70) { score -= 2; reasons.push(`RSI overbought (${s.rsi.toFixed(0)})`); }
    else if (s.rsi <= 40) { score += 1; reasons.push(`RSI low (${s.rsi.toFixed(0)})`); }
    else if (s.rsi >= 60) { score -= 1; reasons.push(`RSI high (${s.rsi.toFixed(0)})`); }

    // --- MACD (±2 crossover, ±0.5 direction) ---
    if (s.macdHist > 0) {
      // Check if fresh crossover by looking at previous candle's MACD
      score += (s.macdLine > s.macdSignal) ? 2 : 0.5;
      reasons.push('MACD bullish');
    } else if (s.macdHist < 0) {
      score -= (s.macdLine < s.macdSignal) ? 2 : 0.5;
      reasons.push('MACD bearish');
    }

    // --- ADX + DI (±1.5) ---
    if (s.adx > 25) {
      if (s.pdi > s.mdi) { score += 1.5; reasons.push(`Strong uptrend (ADX ${s.adx.toFixed(0)})`); }
      else { score -= 1.5; reasons.push(`Strong downtrend (ADX ${s.adx.toFixed(0)})`); }
    }

    // --- Bollinger Bands position (±1.5) ---
    const bbRange = s.bbUpper - s.bbLower;
    if (bbRange > 0) {
      const bbPos = (s.price - s.bbLower) / bbRange;
      if (bbPos <= 0.1) { score += 1.5; reasons.push('At lower BB'); }
      else if (bbPos >= 0.9) { score -= 1.5; reasons.push('At upper BB'); }
    }

    // --- BB squeeze detection (flag only) ---
    const bbWidth = bbRange / s.price;
    const bbWidths = this.recentBBWidths(candles.slice(-60));
    if (bbWidths.length >= 20) {
      const sorted = [...bbWidths].sort((a, b) => a - b);
      const p10 = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
      if (bbWidth < p10) { reasons.push('⚡ BB squeeze'); }
    }

    // --- Volume confirmation (±1) ---
    const volRatio = s.avgVolume20 > 0 ? s.volume / s.avgVolume20 : 1;
    if (volRatio > 1.5) {
      if (score > 0) { score += 1; reasons.push(`Volume spike ${volRatio.toFixed(1)}x (bullish)`); }
      else if (score < 0) { score -= 1; reasons.push(`Volume spike ${volRatio.toFixed(1)}x (bearish)`); }
    }

    // --- Stochastic RSI (±1) ---
    if (s.stochK < 20 && s.stochD < 20) { score += 1; reasons.push('StochRSI oversold'); }
    else if (s.stochK > 80 && s.stochD > 80) { score -= 1; reasons.push('StochRSI overbought'); }

    // --- MFI (±1) ---
    if (s.mfi < 20) { score += 1; reasons.push(`MFI oversold (${s.mfi.toFixed(0)})`); }
    else if (s.mfi > 80) { score -= 1; reasons.push(`MFI overbought (${s.mfi.toFixed(0)})`); }

    // --- CCI (±1) ---
    if (s.cci < -100) { score += 1; reasons.push(`CCI oversold (${s.cci.toFixed(0)})`); }
    else if (s.cci > 100) { score -= 1; reasons.push(`CCI overbought (${s.cci.toFixed(0)})`); }

    // --- VWAP (±1) ---
    if (s.price > s.vwap) { score += 1; reasons.push('Above VWAP'); }
    else if (s.price < s.vwap) { score -= 1; reasons.push('Below VWAP'); }

    // --- OBV trend (±0.5) ---
    // Simple: compare latest OBV direction with price direction
    const recentCloses = candles.slice(-10).map((c) => c.close);
    const priceUp = recentCloses[recentCloses.length - 1]! > recentCloses[0]!;
    // If OBV confirms price direction
    if (priceUp && s.obv > 0) { score += 0.5; reasons.push('OBV confirms up'); }
    else if (!priceUp && s.obv < 0) { score -= 0.5; reasons.push('OBV confirms down'); }

    // --- Williams %R (±0.5) ---
    if (s.williamsR < -80) { score += 0.5; reasons.push('Williams %R oversold'); }
    else if (s.williamsR > -20) { score -= 0.5; reasons.push('Williams %R overbought'); }

    // --- Multi-Timeframe Analysis (±1.5 for alignment, ±0.15 for confidence boost) ---
    if (mtfResult) {
      if (mtfResult.aligned) {
        if (mtfResult.direction === 'bullish' && score > 0) {
          score += mtfResult.confidenceBoost * 10; // Convert confidence boost to score points
          reasons.push(`MTF aligned bullish (${mtfResult.signals.map(s => s.timeframe).join(', ')})`);
        } else if (mtfResult.direction === 'bearish' && score < 0) {
          score -= mtfResult.confidenceBoost * 10; // Negative score for bearish alignment
          reasons.push(`MTF aligned bearish (${mtfResult.signals.map(s => s.timeframe).join(', ')})`);
        } else if (mtfResult.direction !== 'neutral') {
          // MTF suggests opposite direction - reduce confidence
          const conflict = mtfResult.direction === 'bullish' ? 'bullish' : 'bearish';
          reasons.push(`MTF ${conflict} conflicts with signals`);
        }
      } else {
        // Not aligned - mention the conflict
        const directions = mtfResult.signals.map(s => `${s.timeframe}:${s.trend}`).join(', ');
        reasons.push(`MTF mixed signals (${directions})`);
        
        // If higher timeframe disagrees, reduce score
        if (mtfResult.confidenceBoost < 0) {
          score += mtfResult.confidenceBoost * 10; // This will reduce score since boost is negative
          reasons.push('Higher timeframe disagrees');
        }
      }
    }

    return { score: Math.round(score * 10) / 10, reasons };
  }

  private recentBBWidths(candles: Candle[]): number[] {
    if (candles.length < 21) return [];
    const closes = candles.map((c) => c.close);
    const bbArr = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
    return bbArr.map((bb, i) => {
      const px = closes[i + 19] ?? 1;
      return (bb.upper - bb.lower) / px;
    });
  }
}
