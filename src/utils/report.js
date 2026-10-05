// src/utils/report.js
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy'; // SDK 54 compat
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { getData, saveData } from '../utils/storage';
import { getTotalBalance } from './ledger';

const pad = (n) => String(n).padStart(2, '0');
const peso = (n) => `₱${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const ymd = (d) => {
  const dt = new Date(d);
  if (isNaN(dt)) return '';
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
};
const ymLabel = (y, m) => new Date(y, m, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });

function monthRange(year, monthIndex) {
  const start = new Date(year, monthIndex, 1, 0, 0, 0, 0);
  const end = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
  return { start, end };
}
function inRange(dateStr, start, end) {
  const d = new Date(dateStr);
  return !isNaN(d) && d >= start && d <= end;
}

/* ---------------- Android: Save to Downloads ---------------- */
export async function saveToAndroidDownloads(srcUri, filename = 'MonthlyReport.pdf') {
  if (Platform.OS !== 'android') return null;
  try {
    const SAF = FileSystem.StorageAccessFramework;
    let dirUri = await getData('downloads_dir_uri');
    if (!dirUri) {
      const perm = await SAF.requestDirectoryPermissionsAsync();
      if (!perm.granted) return null;
      dirUri = perm.directoryUri;
      await saveData('downloads_dir_uri', dirUri);
    }
    const base64 = await FileSystem.readAsStringAsync(srcUri, { encoding: FileSystem.EncodingType.Base64 });
    const fileUri = await SAF.createFileAsync(dirUri, filename, 'application/pdf');
    await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
    return fileUri;
  } catch (e) { console.warn('saveToAndroidDownloads error:', e); return null; }
}

/* ---------------- Cash series (Total Balance only) ---------------- */
function totalDeltaForLedger(entry) {
  const t = entry?.type;
  const amt = Number(entry?.amount || 0);
  const d = Number(entry?.delta || 0);
  switch (t) {
    case 'ADJUST_TOTAL': return d;
    case 'TOTAL_EXPENSE': return -amt;
    case 'TOTAL_TO_WALLET': return -amt;
    case 'WALLET_TO_TOTAL': return +amt;
    case 'TOTAL_TOP_UP':
    case 'ADD_CASH':
    case 'TOTAL_REFUND': return +amt;
    default: return 0; // wallet-only ops don’t change Total Balance
  }
}
function buildCashSeries(ledgerAll, currentTotal, start, end) {
  const netSinceStart = (ledgerAll || [])
    .filter(r => new Date(r.date || r.timestamp) >= start)
    .reduce((s, r) => s + totalDeltaForLedger(r), 0);
  const startingCash = currentTotal - netSinceStart;

  const lastDay = new Date(end).getDate();
  const monthEntries = (ledgerAll || [])
    .filter(r => inRange(r.date || r.timestamp, start, end))
    .sort((a,b) => new Date(a.date || a.timestamp) - new Date(b.date || b.timestamp));
  const dailyDelta = {};
  monthEntries.forEach(r => {
    const key = ymd(r.date || r.timestamp);
    dailyDelta[key] = (dailyDelta[key] || 0) + totalDeltaForLedger(r);
  });

  const series = [];
  let running = startingCash;
  for (let day=1; day<=lastDay; day++) {
    const key = `${start.getFullYear()}-${pad(start.getMonth()+1)}-${pad(day)}`;
    running += Number(dailyDelta[key] || 0);
    series.push({ date:key, cash: running });
  }
  return { startingCash, series, remainingCash: currentTotal };
}

/* ---------------- helpers: identify “non-expense” wallet movements ---------------- */
const looksLikeTransfer = (txt = '') => {
  const s = String(txt).toLowerCase();
  return (
    s.includes('wallet transfer') ||
    s.includes('transfer to') ||
    s.includes('transfer from') ||
    s.includes('wallet deposit') ||
    s.includes('deposit from total') ||
    s.includes('deposit') && s.includes('total balance')
  );
};
const looksLikeGoalRefund = (txt = '') => String(txt).toLowerCase().includes('goal refund');
const looksLikeGoalPayment = (txt = '') =>
  String(txt).toLowerCase().includes('goal save') ||
  String(txt).toLowerCase().includes('goal payment') ||
  String(txt).toLowerCase().includes('goal pay');

/* ---------------- Dataset builder ---------------- */
export async function buildMonthlyDataset(year, monthIndex) {
  const { start, end } = monthRange(year, monthIndex);

  const wallets = (await getData('wallets')) || [];
  const bills = (await getData('bills')) || [];
  const profile = (await getData('user_profile')) || {};
  const ledger = (await getData('ledger')) || [];

  // Total Balance (cash) only
  const currentTotal = Number((await getTotalBalance()) || 0);
  const { startingCash, series: cashSeries, remainingCash } =
    buildCashSeries(ledger, currentTotal, start, end);

  // Wallet balances (display)
  const walletBalancesList = wallets.map(w => ({
    name: w.name,
    balance: Number(w.balance || 0),
  }));
  const walletBalancesTotal = walletBalancesList.reduce((s, w) => s + Number(w.balance || 0), 0);

  // Spending (wallet expenses + bills paid in month)
  // RULES:
  // - EXCLUDE wallet transfers/deposits/refunds from totals
  // - Count only true expenses:
  //     * wallet debits (amount < 0)  -> use absolute value
  //     * goal payments (Goal Save / Goal payment) even if stored as positive -> use positive value
  // - Bills are always counted (positive amount)
  const tx = [];
  wallets.forEach(w => {
    (w.expenses || []).forEach(e => {
      if (!inRange(e.date, start, end)) return;

      const desc = e.description || '';
      const cat  = e.category || '';
      const amt  = Number(e.amount || 0);

      // skip transfers/deposits & goal refunds
      if (looksLikeTransfer(desc) || looksLikeTransfer(cat) || looksLikeGoalRefund(desc) || looksLikeGoalRefund(cat)) {
        return; // ❌ not an expense
      }

      let expenseValue = 0;

      if (amt < 0) {
        // stored as debit -> expense
        expenseValue = Math.abs(amt);
      } else if (looksLikeGoalPayment(desc) || looksLikeGoalPayment(cat)) {
        // goal payment sometimes stored as positive -> treat as expense
        expenseValue = Math.abs(amt);
      } else {
        // positive credits (deposits, top-ups, refunds, etc.) -> ignore
        return;
      }

      tx.push({
        id: e.id,
        date: e.date,
        walletId: w.id,
        walletName: w.name,
        category: e.category || 'Expense',
        amount: expenseValue,              // normalized as positive “spend”
        source: 'WalletExpense',
      });
    });
  });

  bills.filter(b => b.paid).forEach(b => {
    if (inRange(b.dueDate, start, end)) {
      const w = wallets.find(ww => ww.id === b.walletId);
      tx.push({
        id: b.id,
        date: b.dueDate,
        walletId: b.walletId,
        walletName: w?.name || 'Unknown',
        category: b.title || 'Bill',
        amount: Number(b.amount || 0),     // bills counted as expense
        source: 'Bill',
      });
    }
  });

  const byCategory = {};
  const byWallet = {};
  const dailySpend = {};
  let totalSpent = 0;
  tx.forEach(t => {
    totalSpent += t.amount;
    byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
    byWallet[t.walletName] = (byWallet[t.walletName] || 0) + t.amount;
    const key = ymd(t.date);
    dailySpend[key] = (dailySpend[key] || 0) + t.amount;
  });

  let biggest = null;
  tx.forEach(t => { if (!biggest || t.amount > biggest.amount) biggest = t; });

  // Last month totals (apply the same rules)
  const prevYear = monthIndex === 0 ? year - 1 : year;
  const prevMonthIdx = monthIndex === 0 ? 11 : monthIndex - 1;
  const { start: pStart, end: pEnd } = monthRange(prevYear, prevMonthIdx);
  let prevTotal = 0;
  wallets.forEach(w => (w.expenses || []).forEach(e => {
    if (!inRange(e.date, pStart, pEnd)) return;

    const desc = e.description || '';
    const cat  = e.category || '';
    const amt  = Number(e.amount || 0);

    if (looksLikeTransfer(desc) || looksLikeTransfer(cat) || looksLikeGoalRefund(desc) || looksLikeGoalRefund(cat)) {
      return;
    }
    if (amt < 0) prevTotal += Math.abs(amt);
    else if (looksLikeGoalPayment(desc) || looksLikeGoalPayment(cat)) prevTotal += Math.abs(amt);
  }));
  bills.filter(b => b.paid).forEach(b => {
    if (inRange(b.dueDate, pStart, pEnd)) prevTotal += Number(b.amount || 0);
  });
  const diffPct = prevTotal > 0 ? ((totalSpent - prevTotal) / prevTotal) * 100 : null;

  const recurring = bills
    .filter(b => b.recurring || b.frequency)
    .map(b => ({ title:b.title, amount:b.amount, schedule:b.frequency || 'monthly', dueDate:b.dueDate }));
  const recurringList = recurring.length ? recurring : bills.filter(b => b.paid && inRange(b.dueDate, start, end));

  tx.sort((a,b) => new Date(b.date) - new Date(a.date));

  return {
    profileName: profile.name || '',
    year, monthIndex, monthLabel: ymLabel(year, monthIndex),
    generatedAt: new Date(),

    cashSummary: { startingCash, remainingCash }, // ✅ only Total Balance
    cashSeries,

    // ✅ wallet balances (for display)
    walletBalances: { list: walletBalancesList, total: walletBalancesTotal },

    totals: { byCategory, byWallet, totalSpent, daily: dailySpend },
    transactions: tx,
    biggestExpense: biggest,
    lastMonth: { total: prevTotal, diffPct },
    recurringBills: recurringList,
  };
}

/* ---------------- Charts ---------------- */
function cashLineSVG(series) {
  const W = 560, H = 160, P = 24;
  const innerW = W - P*2, innerH = H - P*2;
  if (!series?.length) return `<svg width="${W}" height="${H}"><text x="${W/2}" y="${H/2}" text-anchor="middle" fill="#888">No cash data</text></svg>`;
  const vals = series.map(p => Number(p.cash || 0));
  const min = Math.min(...vals), max = Math.max(...vals), span = Math.max(1, max - min);
  const pts = series.map((p,i) => {
    const x = P + (i/Math.max(1,series.length-1))*innerW;
    const y = P + (1 - (Number(p.cash)-min)/span)*innerH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg width="${W}" height="${H}" style="max-width:100%">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>
    <polyline fill="none" stroke="#111827" stroke-width="1" points="${P},${P} ${P},${H-P} ${W-P},${H-P}"/>
    <polyline fill="none" stroke="#7C4DFF" stroke-width="2" points="${pts}" />
    <text x="${W - P}" y="${P - 6}" text-anchor="end" fill="#7C4DFF" font-size="12">Cash balance over time</text>
  </svg>`;
}
function pieSVG(byCategory) {
  const entries = Object.entries(byCategory);
  const sum = entries.reduce((s, [,v]) => s + v, 0);
  if (!sum) return `<svg width="220" height="220" viewBox="0 0 220 220"><text x="110" y="115" text-anchor="middle" fill="#888">No data</text></svg>`;
  const colors = ['#7C4DFF','#FF6B7A','#5EA7FF','#ffd166','#36D399','#f487b6','#a0aec0','#fca311','#2a9d8f','#ef476f'];
  let startAngle = 0; const cx=110, cy=110, r=90;
  const slices = entries.map(([label, value], i) => {
    const angle = (value/sum)*Math.PI*2;
    const x1 = cx + r*Math.cos(startAngle), y1 = cy + r*Math.sin(startAngle);
    const x2 = cx + r*Math.cos(startAngle+angle), y2 = cy + r*Math.sin(startAngle+angle);
    const large = angle > Math.PI ? 1 : 0;
    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
    const fill = colors[i % colors.length];
    startAngle += angle;
    return `<path d="${path}" fill="${fill}"><title>${label}</title></path>`;
  }).join('');
  const legend = entries.map(([label, value], i) => {
    const fill = colors[i % colors.length];
    const pct = ((value/sum)*100).toFixed(1);
    return `<div style="display:flex;align-items:center;margin:2px 0;">
      <div style="width:10px;height:10px;background:${fill};border-radius:2px;margin-right:6px;"></div>
      <div style="font-size:12px">${label}</div>
      <div style="margin-left:auto;font-size:12px">${pct}%</div>
    </div>`;
  }).join('');
  return `<div style="display:flex;gap:16px;align-items:center;max-width:100%;">
    <svg width="220" height="220" viewBox="0 0 220 220" style="max-width:220px;width:100%">${slices}</svg>
    <div style="flex:1">${legend}</div>
  </div>`;
}

/* ---------------- Personalized tips ---------------- */
function buildExpenseTips(data) {
  const tips = [];
  const total = data.totals.totalSpent || 0;
  const diffPct = data.lastMonth.diffPct;

  if (diffPct != null && diffPct > 10) {
    tips.push(`You spent <b>${diffPct.toFixed(1)}%</b> more than last month. Try weekly limits or an envelope budget for your top category.`);
  }
  const topCat = Object.entries(data.totals.byCategory).sort((a,b)=>b[1]-a[1])[0];
  if (topCat && total && topCat[1]/total >= 0.4) {
    tips.push(`"${topCat[0]}" eats <b>${((topCat[1]/total)*100).toFixed(0)}%</b> of spending. Set a cap for this category next month.`);
  }
  if (data.cashSeries?.length >= 2) {
    const first = data.cashSeries[0].cash, last = data.cashSeries[data.cashSeries.length-1].cash;
    if (last < first) tips.push(`Your Total Cash fell by ${peso(first-last)} this month. Consider one or two no-spend days to stabilize.`);
  }
  if (diffPct != null && diffPct < -10) {
    tips.push(`Great job! You spent <b>${Math.abs(diffPct).toFixed(1)}%</b> less than last month. Move the extra to a goal or emergency fund.`);
  }
  if (!tips.length) tips.push('Keep going! Review your top 3 categories and set simple caps for next month.');
  return `<ul class="list">${tips.map(t=>`<li>${t}</li>`).join('')}</ul>`;
}

/* ---------------- HTML (print-friendly, minimal whitespace) ---------------- */
function renderHTML(data) {
  const generated = data.generatedAt.toLocaleString();
  const total = data.totals.totalSpent || 0;

  const catRows = Object.entries(data.totals.byCategory)
    .sort((a,b)=>b[1]-a[1])
    .map(([k,v])=>`<tr><td>${k}</td><td style="text-align:right">${peso(v)}</td><td style="text-align:right">${total ? ((v/total)*100).toFixed(1) : '0.0'}%</td></tr>`)
    .join('');

  const walletRowsSpent = Object.entries(data.totals.byWallet)
    .sort((a,b)=>b[1]-a[1])
    .map(([k,v])=>`<tr><td>${k}</td><td style="text-align:right">${peso(v)}</td></tr>`)
    .join('');

  const walletBalanceRows = (data.walletBalances?.list || [])
    .map(w => `<tr><td>${w.name}</td><td style="text-align:right">${peso(w.balance)}</td></tr>`)
    .join('');

  const billsTotal = data.transactions.filter(t=>t.source==='Bill').reduce((s,t)=>s+t.amount,0);

  return `
  <html>
  <head>
    <meta charset="utf-8"/>
    <style>
      @page { size: A4; margin: 14mm; }
      body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color:#161A23; background:#F7F8FC; }
      .wrap { padding: 0; }
      .hero { background:#111522; color:#F7F8FC; border-radius:16px; padding:18px 20px; margin-bottom:16px; }
      .hero .sub { color:#B6BECE; }
      /* Let big cards (tables/graphs) split across pages to avoid huge blank space */
      .card { margin-top:16px; border:1px solid #E3E6EF; border-radius:14px; padding:16px; background:#FFFFFF; }
      .no-break { break-inside: avoid; page-break-inside: avoid; } /* only for small cards */
      .title { font-size: 22px; font-weight: 900; }
      .sub { color:#5b6475; margin-top:4px; }
      .grid2 { display:grid; grid-template-columns: repeat(auto-fit, minmax(260px,1fr)); gap:16px; }
      .row { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
      table { width:100%; border-collapse:collapse; font-size:12px; table-layout:fixed; }
      th, td { padding:8px; border-bottom:1px solid #eee; word-wrap:break-word; }
      th { background:#F1F2F8; text-align:left; color:#586174; }
      .big { font-size:18px; font-weight:900; color:#7C4DFF; }
      .list { padding-left:16px; margin:0; }
      .list li { margin:4px 0; }
    </style>
  </head>
  <body>
    <div class="wrap">

      <div class="hero">
        <div class="title">Monthly Financial Report – ${data.monthLabel}</div>
        <div class="sub">${data.profileName || 'Pengpeng'} · Generated ${generated}</div>
      </div>

      <!-- Cash Summary (no cut) -->
      <div class="card no-break">
        <div class="cardTitle"><b>Cash Summary</b></div>
        <div class="grid2">
          <div><b>Starting Cash:</b> ${peso(data.cashSummary.startingCash)}</div>
          <div><b>Remaining Cash:</b> <span class="big">${peso(data.cashSummary.remainingCash)}</span></div>
        </div>
      </div>

      <!-- Wallet Balances (per-wallet + total) -->
      <div class="card no-break">
        <div class="cardTitle"><b>Wallet Balances</b></div>
        <table style="margin-top:6px">
          <tr><th>Wallet</th><th style="text-align:right">Balance</th></tr>
          ${walletBalanceRows || '<tr><td colspan="2">No wallets</td></tr>'}
        </table>
        <div style="margin-top:8px"><b>Total of wallet balances:</b> ${peso(data.walletBalances?.total || 0)}</div>
      </div>

      <!-- Cash balance over time -->
      <div class="card">
        <div class="cardTitle"><b>Cash balance over time</b></div>
        ${cashLineSVG(data.cashSeries)}
      </div>

      <!-- Quick comparison -->
      <div class="card no-break">
        <div class="cardTitle"><b>Quick comparison: this month vs last month</b></div>
        <div class="grid2">
          <div><b>This month total expense:</b> ${peso(data.totals.totalSpent)}</div>
          <div><b>Last month total expense:</b> ${peso(data.lastMonth.total)}</div>
        </div>
        <div style="margin-top:6px;">
          ${data.lastMonth.diffPct == null
            ? 'No data for last month.'
            : (data.lastMonth.diffPct >= 0
                ? `You spent <b>${data.lastMonth.diffPct.toFixed(1)}%</b> more than last month.`
                : `You spent <b>${Math.abs(data.lastMonth.diffPct).toFixed(1)}%</b> less than last month.`)}
        </div>
      </div>

      <!-- Category Breakdown -->
      <div class="card">
        <div class="cardTitle"><b>Category Breakdown</b></div>
        ${pieSVG(data.totals.byCategory)}
        <table style="margin-top:10px">
          <tr><th>Category</th><th style="text-align:right">Amount</th><th style="text-align:right">Percent</th></tr>
          ${catRows || '<tr><td colspan="3">No data</td></tr>'}
        </table>
      </div>

      <!-- Transaction Summary -->
      <div class="card no-break">
        <div class="cardTitle"><b>Transaction Summary</b></div>
        <ul class="list">
          <li><b>Total Expenses (month):</b> ${peso(data.totals.totalSpent)}</li>
          <li><b>Wallets — Total Expense (month):</b> ${peso(data.totals.totalSpent - billsTotal)}</li>
          <li><b>Bills — Paid (month):</b> ${peso(billsTotal)}</li>
          <li><b>Total Cash (now):</b> ${peso(data.cashSummary.remainingCash)}</li>
        </ul>
      </div>

      <!-- Biggest Expense -->
      <div class="card no-break">
        <div class="cardTitle"><b>Biggest Expense</b></div>
        ${
          data.biggestExpense
            ? `<div class="row"><div>${ymd(data.biggestExpense.date)} — ${data.biggestExpense.category} (${data.biggestExpense.walletName})</div><div style="margin-left:auto"><b>${peso(data.biggestExpense.amount)}</b></div></div>`
            : 'No expenses recorded this month.'
        }
      </div>

      <!-- Personalized tips -->
      <div class="card">
        <div class="cardTitle"><b>Expense Tips</b></div>
        ${buildExpenseTips(data)}
      </div>

    </div>
  </body>
  </html>`;
}

/* ---------------- Export / Persist ---------------- */
export async function exportMonthlyReportPDF(year, monthIndex, filename) {
  const data = await buildMonthlyDataset(year, monthIndex);
  const html = renderHTML(data);
  const { uri: tmpUri } = await Print.printToFileAsync({ html });

  const name = filename || `MonthlyExpenseReport_${data.monthLabel.replace(/ /g, '')}.pdf`;
  const dest = FileSystem.documentDirectory + name;

  try { await FileSystem.moveAsync({ from: tmpUri, to: dest }); return { fileUri: dest, name, data }; }
  catch { return { fileUri: tmpUri, name, data }; }
}

export async function shareReport(fileUri) {
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(fileUri);
}

export async function exportAndPersistMonthlyReport(year, monthIndex) {
  const data = await buildMonthlyDataset(year, monthIndex);
  const html = renderHTML(data);
  const { uri: tmpUri } = await Print.printToFileAsync({ html });

  const name = `MonthlyExpenseReport_${data.monthLabel.replace(/ /g, '')}.pdf`;
  const dest = FileSystem.documentDirectory + name;
  let fileUri = tmpUri;
  try { await FileSystem.moveAsync({ from: tmpUri, to: dest }); fileUri = dest; } catch {}

  await saveData('reports:last', data);
  await saveData('report:lastHtml', html);
  await saveData('report:lastFileUri', fileUri);
  await saveData('report:lastName', name);

  return { fileUri, name, html, data };
}

export async function getLatestReportMeta() {
  const [data, html, fileUri, name] = await Promise.all([
    getData('reports:last'),
    getData('report:lastHtml'),
    getData('report:lastFileUri'),
    getData('report:lastName'),
  ]);
  if (!data && !html && !fileUri) return null;
  return { data, html, fileUri, name: name || 'MonthlyReport.pdf' };
}

export async function exportPersistAndMaybeSaveToDownloads(year, monthIndex) {
  const res = await exportAndPersistMonthlyReport(year, monthIndex);
  if (Platform.OS === 'android') {
    const savedUri = await saveToAndroidDownloads(res.fileUri, res.name);
    return { ...res, downloadsUri: savedUri || null };
  }
  return res;
}
