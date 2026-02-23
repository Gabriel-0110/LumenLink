#!/usr/bin/env tsx
/**
 * Generate a comprehensive trading report by cross-referencing the local
 * trade journal with actual Coinbase order data.
 */
import { buildCoinbaseHeaders } from '../src/exchanges/coinbase/auth.js';
import { createCoinbaseClient } from '../src/exchanges/coinbase/client.js';
import { coinbaseEndpoints } from '../src/exchanges/coinbase/endpoints.js';
import { getJson } from '../src/core/http.js';
import { buildSecretsProvider } from '../src/secrets/provider.js';
import { loadConfig } from '../src/config/load.js';
import Database from 'better-sqlite3';
import path from 'node:path';

interface JournalRow {
  id: number;
  trade_id: string;
  symbol: string;
  side: string;
  action: string;
  strategy: string;
  order_id: string;
  requested_price: number;
  filled_price: number;
  slippage_bps: number;
  quantity: number;
  notional_usd: number;
  commission_usd: number;
  confidence: number;
  reason: string;
  risk_decision: string;
  realized_pnl_usd: number | null;
  realized_pnl_pct: number | null;
  mode: string;
  timestamp: number;
  date_str: string;
}

interface CoinbaseOrder {
  order: {
    order_id: string;
    product_id: string;
    side: string;
    status: string;
    filled_size: string;
    average_filled_price: string;
    total_fees: string;
    filled_value: string;
    number_of_fills: string;
    created_time: string;
    last_fill_time: string;
    completion_percentage: string;
    order_configuration: Record<string, any>;
    settled: boolean;
  };
}

async function main() {
  // --- Setup ---
  const config = loadConfig();
  const secrets = buildSecretsProvider(config);
  const apiKey = await secrets.getSecret(config.secrets.secretIds.coinbaseKey, 'COINBASE_API_KEY');
  const apiSecret = await secrets.getSecret(config.secrets.secretIds.coinbaseSecret, 'COINBASE_API_SECRET');
  const auth = { apiKey, apiSecret };

  // --- Query local journal ---
  const dbPath = path.resolve('data/runtime.sqlite');
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare(`
    SELECT * FROM trade_journal ORDER BY timestamp ASC
  `).all() as JournalRow[];
  db.close();

  console.log('='.repeat(120));
  console.log('  LUMENLINK TRADING REPORT');
  console.log(`  Generated: ${new Date().toISOString()}`);
  console.log(`  Total journal entries: ${rows.length}`);
  console.log('='.repeat(120));

  // --- Fetch Coinbase fills ---
  const fillsPath = `/api/v3/brokerage/orders/historical/fills?product_ids=BTC-USD&limit=50`;
  const fillsHeaders = buildCoinbaseHeaders(auth, 'GET', fillsPath, '');
  let coinbaseFills: any[] = [];
  try {
    const fillsData = await getJson<any>(createCoinbaseClient(), fillsPath, fillsHeaders);
    coinbaseFills = fillsData.fills ?? [];
  } catch (e) {
    console.error('  [WARN] Could not fetch Coinbase fills:', (e as Error).message);
  }

  // --- Fetch Coinbase account balances ---
  const accountsPath = coinbaseEndpoints.accounts();
  const accountsHeaders = buildCoinbaseHeaders(auth, 'GET', accountsPath, '');
  let balances: { asset: string; available: number; hold: number }[] = [];
  try {
    const accountsData = await getJson<any>(createCoinbaseClient(), accountsPath, accountsHeaders);
    balances = (accountsData.accounts ?? []).map((a: any) => ({
      asset: a.currency,
      available: Number(a.available_balance?.value ?? 0),
      hold: Number(a.hold?.value ?? 0),
    }));
  } catch (e) {
    console.error('  [WARN] Could not fetch Coinbase balances:', (e as Error).message);
  }

  // --- Fetch each order from Coinbase and compare ---
  const orderIds = [...new Set(rows.map(r => r.order_id))];

  // Also include the very first order from the prior session if not in journal
  const firstOrderId = '52b16e00-65f5-495c-b0a3-e21f295736c5';
  if (!orderIds.includes(firstOrderId)) {
    orderIds.unshift(firstOrderId);
  }

  const coinbaseOrders: Map<string, CoinbaseOrder['order']> = new Map();
  for (const orderId of orderIds) {
    try {
      const orderPath = coinbaseEndpoints.order(orderId);
      const orderHeaders = buildCoinbaseHeaders(auth, 'GET', orderPath, '');
      const data = await getJson<CoinbaseOrder>(createCoinbaseClient(), orderPath, orderHeaders);
      coinbaseOrders.set(orderId, data.order);
    } catch (e) {
      console.error(`  [WARN] Could not fetch order ${orderId}: ${(e as Error).message}`);
    }
    // Rate limit
    await new Promise(r => setTimeout(r, 150));
  }

  // --- Print the first order (prior session, not in journal) ---
  const firstOrder = coinbaseOrders.get(firstOrderId);
  if (firstOrder && !rows.find(r => r.order_id === firstOrderId)) {
    console.log('\n' + '-'.repeat(120));
    console.log('  TRADE #0 (Prior session — NOT in journal)');
    console.log('-'.repeat(120));
    console.log(`  Order ID:        ${firstOrder.order_id}`);
    console.log(`  Side:            ${firstOrder.side}`);
    console.log(`  Status:          ${firstOrder.status}`);
    console.log(`  Filled Size:     ${firstOrder.filled_size} BTC`);
    console.log(`  Avg Fill Price:  $${Number(firstOrder.average_filled_price).toFixed(2)}`);
    console.log(`  Total Fees:      $${Number(firstOrder.total_fees).toFixed(4)}`);
    console.log(`  Filled Value:    $${Number(firstOrder.filled_value).toFixed(2)}`);
    console.log(`  # Fills:         ${firstOrder.number_of_fills}`);
    console.log(`  Created:         ${firstOrder.created_time}`);
    console.log(`  Last Fill:       ${firstOrder.last_fill_time}`);
    console.log(`  Settled:         ${firstOrder.settled}`);
    console.log(`  ** NOT RECORDED in trade journal **`);
  }

  // --- Per-trade detailed comparison ---
  let totalLocalNotional = 0;
  let totalCoinbaseNotional = 0;
  let totalLocalFees = 0;
  let totalCoinbaseFees = 0;
  let totalRealizedPnl = 0;
  let totalBuyQty = 0;
  let totalSellQty = 0;
  let totalBuyNotional = 0;
  let totalSellNotional = 0;
  let issueCount = 0;
  const issues: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const cbOrder = coinbaseOrders.get(r.order_id);

    console.log('\n' + '-'.repeat(120));
    console.log(`  TRADE #${i + 1}  |  ${r.side.toUpperCase()} ${r.action.toUpperCase()}  |  ${new Date(r.timestamp).toISOString()}`);
    console.log('-'.repeat(120));

    // Local journal data
    console.log('  [LOCAL JOURNAL]');
    console.log(`    Order ID:        ${r.order_id}`);
    console.log(`    Symbol:          ${r.symbol}`);
    console.log(`    Side / Action:   ${r.side} / ${r.action}`);
    console.log(`    Strategy:        ${r.strategy}`);
    console.log(`    Requested Price: $${r.requested_price.toFixed(2)}`);
    console.log(`    Filled Price:    $${r.filled_price.toFixed(2)}`);
    console.log(`    Slippage:        ${r.slippage_bps.toFixed(4)} bps`);
    console.log(`    Quantity:        ${r.quantity.toFixed(8)} BTC`);
    console.log(`    Notional:        $${r.notional_usd.toFixed(4)}`);
    console.log(`    Commission:      $${r.commission_usd.toFixed(4)}`);
    console.log(`    Confidence:      ${r.confidence}`);
    console.log(`    Realized PnL:    ${r.realized_pnl_usd != null ? '$' + r.realized_pnl_usd.toFixed(6) : 'N/A'}`);
    console.log(`    Realized PnL %:  ${r.realized_pnl_pct != null ? r.realized_pnl_pct.toFixed(6) + '%' : 'N/A'}`);
    console.log(`    Risk Decision:   ${r.risk_decision}`);
    console.log(`    Mode:            ${r.mode}`);
    console.log(`    Reason:          ${r.reason.substring(0, 120)}...`);

    // Coinbase data
    if (cbOrder) {
      const cbQty = Number(cbOrder.filled_size);
      const cbPrice = Number(cbOrder.average_filled_price);
      const cbFees = Number(cbOrder.total_fees);
      const cbNotional = Number(cbOrder.filled_value);

      console.log('  [COINBASE ACTUAL]');
      console.log(`    Status:          ${cbOrder.status}`);
      console.log(`    Filled Size:     ${cbOrder.filled_size} BTC`);
      console.log(`    Avg Fill Price:  $${cbPrice.toFixed(2)}`);
      console.log(`    Total Fees:      $${cbFees.toFixed(4)}`);
      console.log(`    Filled Value:    $${cbNotional.toFixed(4)}`);
      console.log(`    # Fills:         ${cbOrder.number_of_fills}`);
      console.log(`    Created:         ${cbOrder.created_time}`);
      console.log(`    Last Fill:       ${cbOrder.last_fill_time}`);
      console.log(`    Settled:         ${cbOrder.settled}`);
      console.log(`    Completion:      ${cbOrder.completion_percentage}%`);

      // --- DISCREPANCY CHECK ---
      const qtyDiff = Math.abs(r.quantity - cbQty);
      const priceDiff = Math.abs(r.filled_price - cbPrice);
      const feeDiff = Math.abs(r.commission_usd - cbFees);
      const notionalDiff = Math.abs(r.notional_usd - cbNotional);

      console.log('  [DISCREPANCIES]');
      if (qtyDiff > 1e-10) {
        const issue = `Trade #${i + 1}: Quantity mismatch — local ${r.quantity.toFixed(8)} vs CB ${cbQty.toFixed(8)} (diff: ${qtyDiff.toFixed(10)})`;
        console.log(`    ⚠️  ${issue}`);
        issues.push(issue);
        issueCount++;
      } else {
        console.log(`    ✅ Quantity matches`);
      }

      if (priceDiff > 0.01) {
        const issue = `Trade #${i + 1}: Price mismatch — local $${r.filled_price.toFixed(2)} vs CB $${cbPrice.toFixed(2)} (diff: $${priceDiff.toFixed(4)})`;
        console.log(`    ⚠️  ${issue}`);
        issues.push(issue);
        issueCount++;
      } else {
        console.log(`    ✅ Fill price matches`);
      }

      if (feeDiff > 0.01) {
        const issue = `Trade #${i + 1}: Fee mismatch — local $${r.commission_usd.toFixed(4)} vs CB $${cbFees.toFixed(4)} (diff: $${feeDiff.toFixed(4)})`;
        console.log(`    ⚠️  ${issue}`);
        issues.push(issue);
        issueCount++;
      } else {
        console.log(`    ✅ Fees match`);
      }

      if (cbOrder.status !== 'FILLED') {
        const issue = `Trade #${i + 1}: Order not FILLED — status is ${cbOrder.status}`;
        console.log(`    ⚠️  ${issue}`);
        issues.push(issue);
        issueCount++;
      } else {
        console.log(`    ✅ Order fully filled`);
      }

      totalCoinbaseNotional += cbNotional;
      totalCoinbaseFees += cbFees;
    } else {
      console.log('  [COINBASE ACTUAL]');
      console.log(`    ❌ Order not found on Coinbase`);
      issues.push(`Trade #${i + 1}: Order ${r.order_id} not found on Coinbase`);
      issueCount++;
    }

    totalLocalNotional += r.notional_usd;
    totalLocalFees += r.commission_usd;
    if (r.realized_pnl_usd != null) totalRealizedPnl += r.realized_pnl_usd;
    if (r.side === 'buy') {
      totalBuyQty += r.quantity;
      totalBuyNotional += r.notional_usd;
    } else {
      totalSellQty += r.quantity;
      totalSellNotional += r.notional_usd;
    }
  }

  // --- Fill analysis from Coinbase ---
  console.log('\n' + '='.repeat(120));
  console.log('  COINBASE FILLS (raw from /fills endpoint)');
  console.log('='.repeat(120));
  for (const fill of coinbaseFills) {
    console.log(`  ${fill.trade_time} | ${fill.side} | ${fill.size} BTC @ $${Number(fill.price).toFixed(2)} | Fee: $${Number(fill.commission).toFixed(4)} | Order: ${fill.order_id}`);
  }

  // --- Summary ---
  console.log('\n' + '='.repeat(120));
  console.log('  SUMMARY');
  console.log('='.repeat(120));
  console.log(`  Total Trades:          ${rows.length} (${rows.filter(r => r.side === 'buy').length} buys, ${rows.filter(r => r.side === 'sell').length} sells)`);
  console.log(`  Total BUY Qty:         ${totalBuyQty.toFixed(8)} BTC ($${totalBuyNotional.toFixed(2)})`);
  console.log(`  Total SELL Qty:        ${totalSellQty.toFixed(8)} BTC ($${totalSellNotional.toFixed(2)})`);
  console.log(`  Net Position Change:   ${(totalBuyQty - totalSellQty).toFixed(8)} BTC`);
  console.log(`  Local Notional:        $${totalLocalNotional.toFixed(2)}`);
  console.log(`  Coinbase Notional:     $${totalCoinbaseNotional.toFixed(2)}`);
  console.log(`  Local Fees:            $${totalLocalFees.toFixed(4)}`);
  console.log(`  Coinbase Fees:         $${totalCoinbaseFees.toFixed(4)}`);
  console.log(`  Fee Discrepancy:       $${Math.abs(totalLocalFees - totalCoinbaseFees).toFixed(4)}`);
  console.log(`  Realized PnL (local):  $${totalRealizedPnl.toFixed(6)}`);

  // --- Current Coinbase Balances ---
  console.log('\n' + '='.repeat(120));
  console.log('  CURRENT COINBASE BALANCES');
  console.log('='.repeat(120));
  const btc = balances.find(b => b.asset === 'BTC');
  const usd = balances.find(b => b.asset === 'USD');
  const usdc = balances.find(b => b.asset === 'USDC');
  if (btc) console.log(`  BTC:   ${btc.available.toFixed(8)} (hold: ${btc.hold.toFixed(8)})`);
  if (usd) console.log(`  USD:   $${usd.available.toFixed(2)} (hold: $${usd.hold.toFixed(2)})`);
  if (usdc) console.log(`  USDC:  $${usdc.available.toFixed(2)} (hold: $${usdc.hold.toFixed(2)})`);
  const btcPrice = rows.length > 0 ? rows[rows.length - 1]!.filled_price : 0;
  const totalValue = (btc?.available ?? 0) * btcPrice + (usd?.available ?? 0) + (usdc?.available ?? 0);
  console.log(`  Total (est):  $${totalValue.toFixed(2)} (BTC @ $${btcPrice.toFixed(2)})`);

  // --- Bot dashboard state ---
  try {
    const resp = await fetch('http://localhost:8080/api/data');
    const dashboard = await resp.json() as any;
    console.log('\n' + '='.repeat(120));
    console.log('  DASHBOARD STATE (in-memory snapshot)');
    console.log('='.repeat(120));
    console.log(`  Cash:              $${Number(dashboard.cash).toFixed(2)}`);
    for (const p of dashboard.positions ?? []) {
      console.log(`  Position:          ${p.quantity} ${p.symbol} @ $${Number(p.marketPrice).toFixed(2)} (entry: $${Number(p.avgEntryPrice).toFixed(2)})`);
    }
    console.log(`  Total Equity:      $${Number(dashboard.totalEquityUsd).toFixed(2)}`);
    console.log(`  Realized PnL:      $${Number(dashboard.realizedPnlUsd).toFixed(6)}`);
    console.log(`  Today Trades:      ${dashboard.today?.totalTrades ?? 0}`);
    console.log(`  Today Wins:        ${dashboard.today?.wins ?? 0}`);
    console.log(`  Today Losses:      ${dashboard.today?.losses ?? 0}`);
  } catch {
    console.log('\n  [WARN] Could not reach dashboard at http://localhost:8080/api/data');
  }

  // --- Issues Summary ---
  console.log('\n' + '='.repeat(120));
  console.log('  ISSUES & ANOMALIES');
  console.log('='.repeat(120));

  // Check for trade logic issues
  const sellsAfterBuy = rows.filter(r => r.action === 'exit' && r.side === 'sell');
  const buys = rows.filter(r => r.action === 'entry' && r.side === 'buy');

  // Check sells with 0 realized PnL (likely the timing bug)
  const zeroPnlSells = sellsAfterBuy.filter(r => r.realized_pnl_usd != null && Math.abs(r.realized_pnl_usd) < 0.001);
  
  // Check sells happening when oscillators say oversold  
  const oversoldSells = rows.filter(r => r.side === 'sell' && r.reason.includes('oversold'));

  // Check fees = 0 (pre-fix trades)
  const zeroFeeTrades = rows.filter(r => r.commission_usd === 0);

  // Check net BTC position vs Coinbase
  const netLocalBtc = totalBuyQty - totalSellQty;
  const actualBtc = btc?.available ?? 0;

  // Check if selling into oversold conditions
  if (oversoldSells.length > 0) {
    const issue = `STRATEGY BUG: ${oversoldSells.length} SELL trades executed while oscillators indicate OVERSOLD conditions`;
    issues.push(issue);
    console.log(`  ⚠️  ${issue}`);
    for (const s of oversoldSells) {
      console.log(`      Trade #${rows.indexOf(s) + 1}: ${s.reason.substring(0, 100)}`);
    }
  }

  if (zeroFeeTrades.length > 0) {
    const issue = `${zeroFeeTrades.length} trades recorded with $0.00 commission (pre-fee-tracking fix)`;
    issues.push(issue);
    console.log(`  ⚠️  ${issue}`);
    console.log(`      Trade IDs: ${zeroFeeTrades.map((_, i) => '#' + (rows.indexOf(_) + 1)).join(', ')}`);
  }

  // Count consecutive sells without buy
  let maxConsecutiveSells = 0;
  let currentStreak = 0;
  for (const r of rows) {
    if (r.side === 'sell') {
      currentStreak++;
      maxConsecutiveSells = Math.max(maxConsecutiveSells, currentStreak);
    } else {
      currentStreak = 0;
    }
  }
  if (maxConsecutiveSells > 3) {
    const issue = `${maxConsecutiveSells} consecutive SELL trades without a BUY — liquidating position excessively`;
    issues.push(issue);
    console.log(`  ⚠️  ${issue}`);
  }

  // Check if bot is selling BTC it started with (not bought during session)
  if (buys.length === 0) {
    issues.push('No BUY trades in this session — only selling initial position');
    console.log('  ⚠️  No BUY trades — only selling the initial BTC position');
  }

  // P&L sanity: check if all sells combined are net negative
  const netSellPnl = sellsAfterBuy.reduce((s, r) => s + (r.realized_pnl_usd ?? 0), 0);
  if (netSellPnl < -1) {
    const issue = `Net realized PnL on all sells: $${netSellPnl.toFixed(4)} — losing money on trades`;
    issues.push(issue);
    console.log(`  ⚠️  ${issue}`);
  }

  // Check local net BTC vs Coinbase balance
  // The bot started with some BTC. Net local change should match.
  console.log(`\n  Net local BTC change (buys - sells): ${netLocalBtc.toFixed(8)} BTC`);
  console.log(`  Coinbase BTC balance:                ${actualBtc.toFixed(8)} BTC`);

  // Print each issue in summary
  if (issues.length === 0) {
    console.log('\n  ✅ No issues detected');
  } else {
    console.log(`\n  Total issues: ${issues.length}`);
  }

  // --- Trade Flow Timeline ---
  console.log('\n' + '='.repeat(120));
  console.log('  TRADE FLOW TIMELINE');
  console.log('='.repeat(120));

  let runningBtc = 0.00889379; // starting BTC from Coinbase (prior to first order)
  let runningCash = 398.52;    // starting USD
  // Account for trade #0 (prior session sell)
  if (firstOrder) {
    const t0Qty = Number(firstOrder.filled_size);
    const t0Price = Number(firstOrder.average_filled_price);
    const t0Fees = Number(firstOrder.total_fees);
    runningBtc -= t0Qty;
    runningCash += t0Qty * t0Price - t0Fees;
    console.log(`  #0  SELL ${t0Qty.toFixed(8)} BTC @ $${t0Price.toFixed(2)} (fees: $${t0Fees.toFixed(2)})  →  BTC: ${runningBtc.toFixed(8)}  Cash: $${runningCash.toFixed(2)}  [prior session]`);
  }

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const cbOrder = coinbaseOrders.get(r.order_id);
    const cbFees = cbOrder ? Number(cbOrder.total_fees) : r.commission_usd;

    if (r.side === 'buy') {
      runningBtc += r.quantity;
      runningCash -= r.notional_usd + cbFees;
    } else {
      runningBtc -= r.quantity;
      runningCash += r.notional_usd - cbFees;
    }
    console.log(`  #${i + 1}  ${r.side.toUpperCase()} ${r.quantity.toFixed(8)} BTC @ $${r.filled_price.toFixed(2)} (fees: $${cbFees.toFixed(2)})  →  BTC: ${runningBtc.toFixed(8)}  Cash: $${runningCash.toFixed(2)}  PnL: ${r.realized_pnl_usd != null ? '$' + r.realized_pnl_usd.toFixed(4) : '-'}`);
  }

  console.log(`\n  Expected final:  BTC: ${runningBtc.toFixed(8)}  Cash: $${runningCash.toFixed(2)}`);
  console.log(`  Coinbase actual: BTC: ${(btc?.available ?? 0).toFixed(8)}  Cash: $${(usd?.available ?? 0).toFixed(2)}`);
  const btcDiff = Math.abs(runningBtc - (btc?.available ?? 0));
  const cashDiff = Math.abs(runningCash - (usd?.available ?? 0));
  if (btcDiff > 1e-8) {
    console.log(`  ⚠️  BTC discrepancy: ${btcDiff.toFixed(10)}`);
  } else {
    console.log(`  ✅ BTC matches`);
  }
  if (cashDiff > 0.1) {
    console.log(`  ⚠️  Cash discrepancy: $${cashDiff.toFixed(4)}`);
  } else {
    console.log(`  ✅ Cash matches`);
  }

  console.log('\n' + '='.repeat(120));
  console.log('  END OF REPORT');
  console.log('='.repeat(120));
}

main().catch(console.error);
