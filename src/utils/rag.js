// src/utils/rag.js
//
// Unified RAG + aggregates used by AIScreen + Home parity.
// Counts spend from:
//  • Wallet expenses (NEGATIVE amounts as positive spend; skips transfers/deposit/withdraw)
//  • Legacy bills (bills[] where paid)
//  • Subscriptions/Payables (payables_v1 via listPayables()) — use .history entries
//  • Total-balance expenses (ledger[] type === 'TOTAL_EXPENSE')
// Also exposes Savings Goals summaries for AI.
// Provides: ensureRagKB, rebuildKBFromStorage, computeAggregates,
//           buildContextBlocks, getYesterdaySnapshot, searchRag
//
// NOTE: This mirrors HomeScreen rules so Today/ThisMonth match.

import { getData, saveData } from './storage';
import { canonicalizeCategory, normalizeWalletTiles } from './categoryTilesGuard';
import { getBudgets, THIS_MONTH, monthKey } from './budgets';
import { getTotalBalance } from './ledger';
import { listPayables } from './payables';

// ---------- tiny vector store (kept API) ----------
const KB_KEY = 'rag_kb_docs_v1';
const VOCAB_KEY = 'rag_kb_vocab_v1';
const MAX_DOCS = 5000;

const STOP = new Set([
  'the','a','an','and','or','to','for','on','of','in','at','with','from','by','my','our','your',
  'pay','paid','bill','expense','spent','buy','bought','purchase','fee'
]);

const tok = (s='') => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g,' ')
  .split(/\s+/).filter(x=>x && !STOP.has(x));
const vec = (tokens) => {
  const v={}; tokens.forEach(t=>v[t]=(v[t]||0)+1);
  const n=Math.sqrt(Object.values(v).reduce((s,x)=>s+x*x,0))||1;
  Object.keys(v).forEach(k=>v[k]/=n);
  return v;
};
const cos = (a,b)=>{ let s=0; const sh=Object.keys(a).length<=Object.keys(b).length?a:b; const lo=sh===a?b:a;
  for(const k in sh) if(lo[k]) s+=sh[k]*lo[k]; return s; };
const id = ()=>`${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const two = (n)=>String(n).padStart(2,'0');
const ymd = (d)=>{ const dt=new Date(d); if(isNaN(dt)) return ''; return `${dt.getFullYear()}-${two(dt.getMonth()+1)}-${two(dt.getDate())}`; };
const prevMonthKey = (k)=>{ if(!k||!/^\d{4}-\d{2}$/.test(k)) return ''; const [yS,mS]=k.split('-'); let y=+yS,m=+mS-1; if(m===0){m=12;y--;} return `${y}-${two(m)}`; };
const addMonthsKey=(k,delta)=>{ const [yS,mS]=(k||'').split('-'); if(!yS||!mS) return ''; let y=+yS,m=+mS+delta; while(m<=0){m+=12;y--;} while(m>12){m-=12;y++;} return `${y}-${two(m)}`; };

export async function ensureRagKB(){
  if(!Array.isArray(await getData(KB_KEY))) await saveData(KB_KEY,[]);
  const v = await getData(VOCAB_KEY);
  if(!v || typeof v!=='object') await saveData(VOCAB_KEY,{});
}

export async function ingestTransaction(t={}){
  const docs=(await getData(KB_KEY))||[];
  const vocab=(await getData(VOCAB_KEY))||{};
  const text=[t.description||'',t.category||'',t.walletName||'',t.source||''].join(' ').trim();
  const tokens=tok(text); const v=vec(tokens);
  const doc={ id:id(), text, vec:v, kind:t.kind||'expense', amount:+(t.amount||0),
    date:t.date||new Date().toISOString(), walletId:t.walletId||null, walletName:t.walletName||null,
    category:t.category||'Others', source:t.source||'Wallet', extra:t.extra||null };
  docs.push(doc); while(docs.length>MAX_DOCS) docs.shift();
  new Set(tokens).forEach(tt=>{vocab[tt]=(vocab[tt]||0)+1;});
  await saveData(KB_KEY,docs); await saveData(VOCAB_KEY,vocab);
  return doc.id;
}

export async function querySimilar(q,{topK=8,walletId=null}={}){
  const docs=(await getData(KB_KEY))||[];
  const qv=vec(tok(q||''));
  return docs.filter(d=>!walletId||d.walletId===walletId)
    .map(d=>({doc:d,score:cos(qv,d.vec)}))
    .sort((a,b)=>b.score-a.score).slice(0,topK);
}

export async function suggestCategoryFromRAG(description, wallet){
  const docs=(await getData(KB_KEY))||[];
  if(!docs.length) return null;
  const q = (description||'').trim(); if(!q) return null;
  const top = await querySimilar(q,{topK:10,walletId:wallet?.id||null});
  if(!top.length) return null;
  const vote={}; top.forEach(({doc,score})=>{ vote[doc.category]=(vote[doc.category]||0)+score; });
  const best = Object.entries(vote).sort((a,b)=>b[1]-a[1])[0]?.[0];
  if(!best) return null;
  const tiles = normalizeWalletTiles(wallet?.tiles||[]);
  return canonicalizeCategory(best, tiles);
}

// ---------- KB bulk rebuild ----------
export async function rebuildKBFromStorage(){
  const wallets=(await getData('wallets'))||[];
  const ledger=(await getData('ledger'))||[];
  const billsLegacy=(await getData('bills'))||[];
  let payables=[];
  try { payables = await listPayables(); } catch { payables = (await getData('payables_v1')) || []; }
  const budgets=await getBudgets();
  const savingsGoals=(await getData('savings_goals_v1'))||[];
  const history=(await getData('history'))||[];

  const docs=[]; const vocab={};
  const add=(text,payload={})=>{
    const tokens=tok(text); const v=vec(tokens);
    const doc={ id:id(), text, vec:v, ...payload };
    docs.push(doc);
    new Set(tokens).forEach(t=>{vocab[t]=(vocab[t]||0)+1;});
  };

  // Wallet expenses
  for(const w of wallets){
    (w.expenses||[]).forEach(e=>{
      add(`${e.description||''} ${(e.category||w.name||'Expense')} ${w.name||'Wallet'} expense`,{
        kind:'expense', amount:+(e.amount||0), date:e.date||new Date().toISOString(),
        walletId:w.id||null, walletName:w.name||null, category:e.category||w.name||'Expense', source:'Wallet',
        extra:{expenseId:e.id||null}
      });
    });
  }

  // Ledger transfers
  (ledger||[]).forEach(L=>{
    if((L.type||'').toUpperCase()==='WALLET_TRANSFER'){
      add('wallet transfer',{kind:'transfer', amount:+(L.amount||0), date:L.date||new Date().toISOString(),
        walletId:null, walletName:null, category:'Transfer', source:'Ledger',
        extra:{fromWalletId:L.fromWalletId||null, toWalletId:L.toWalletId||null}});
    }
  });

  // Wallet balances
  for(const w of wallets){
    add(`wallet balance ${w.name||'Wallet'}`,{kind:'wallet_balance', amount:+(w.balance||0), date:new Date().toISOString(),
      walletId:w.id||null, walletName:w.name||null, category:'Balance', source:'Wallet'});
  }

  // Total balance
  try{
    const tb=+(await getTotalBalance()||0);
    add('total balance',{kind:'total_balance', amount:tb, date:new Date().toISOString(),
      walletId:null, walletName:'TOTAL', category:'Balance', source:'Ledger'});
  }catch{}

  // Legacy bills
  (billsLegacy||[]).forEach(b=>{
    const paid=!!b.paid;
    add(`${b.title||'Bill'} bill ${paid?'paid':'unpaid'}`,{
      kind:'bill', amount:+(b.amount||0), date:b.paidAt||b.dueDate||new Date().toISOString(),
      walletId:b.walletId||null, walletName:(wallets.find(w=>w.id===b.walletId)?.name)||null,
      category:b.category||'Bills', source:'Bills', extra:{status:paid?'paid':'unpaid'}
    });
  });

  // Payables / subscriptions (meta)
  (payables||[]).forEach(p=>{
    const isSub = !!(p.subscription || p.isSubscription);
    add(`${p.name||p.title||'Payable'} ${isSub?'subscription':'bill'}`,{
      kind:isSub?'subscription':'bill', amount:+(p.amount||0),
      date:p.dueDate || p.nextDue || p.lastPaidDate || new Date().toISOString(),
      walletId:p.walletId||null, walletName:(wallets.find(w=>w.id===p.walletId)?.name)||null,
      category:p.category || (isSub?'Subscription':'Bills'), source:'Payables'
    });
    // history lines for grounding
    (p.history||[]).forEach(h=>{
      add(`${p.name||'Payable'} history`,{
        kind:'bill_payment', amount:+(h.amount ?? p.amount ?? 0), date:h.date || p.lastPaidDate || new Date().toISOString(),
        walletId:h.source==='wallet' ? (p.walletId||null) : null,
        walletName:(wallets.find(w=>w.id===p.walletId)?.name)||null,
        category:p.category || 'Bills', source:h.source==='wallet'?'Wallet':'Total'
      });
    });
  });

  // Savings goals
  for(const s of (savingsGoals||[])){
    add(`${s.name||'Savings Goal'} target`,{
      kind:'savings_goal', amount:+(s.target || s.amount || 0),
      date:s.updatedAt || s.createdAt || new Date().toISOString(),
      walletId:s.walletId||null, walletName:(wallets.find(w=>w.id===s.walletId)?.name)||null,
      category:'Savings', source:'SavingsGoals',
      extra:{progress:+(s.progress||s.saved||0), deadline:s.deadline||null, plan:s.plan||null, monthlyPlan:+(s.monthlyPlan||s.planAmount||0)}
    });
  }

  // Budgets snapshot
  try{
    const includeBills=!!budgets?.flags?.includeBills;
    const gcap=+(budgets?.global?.totalCap||0)||null;
    add(`budgets snapshot ${includeBills?'include bills':'exclude bills'} global ${gcap||'none'}`,{
      kind:'budgets_snapshot', amount:gcap||0, date:new Date().toISOString(),
      walletId:null, walletName:null, category:'Budgets', source:'Budgets',
      extra:{ includeBills, byWallet: budgets?.byWallet || {} }
    });
  }catch{}

  // History feed
  (history||[]).forEach(h=>{
    add(`${h.title||h.category||'History'} ${h.type||''}`.trim(),{
      kind:(h.kind||h.type||'history').toLowerCase(), amount:+(h.amount||0),
      date:h.date||h.createdAt||new Date().toISOString(),
      walletId:h.walletId||null, walletName:h.walletName||null, category:h.category||'History', source:'History'
    });
  });

  await saveData(KB_KEY, docs.slice(-MAX_DOCS));
  await saveData(VOCAB_KEY, vocab);
}

// ---------- Aggregates that match Home ----------
const isNonExpense = (desc='')=>{
  const d=String(desc).toLowerCase();
  return d.includes('wallet transfer') || d.includes('deposit') || d.includes('withdraw');
};

export async function computeAggregates(){
  const wallets=(await getData('wallets'))||[];
  const billsLegacy=(await getData('bills'))||[];
  const ledger=(await getData('ledger'))||[];
  let payables=[];
  try { payables = await listPayables(); } catch { payables = (await getData('payables_v1')) || []; }
  const budgets=await getBudgets();
  const includeBills=!!budgets?.flags?.includeBills;
  const totalBalance=+(await getTotalBalance()||0);

  // flat txs for day/month math
  const flat=[];

  // Wallet expenses (negatives → positive spend)
  wallets.forEach(w=>{
    (w.expenses||[]).forEach(e=>{
      if(!e?.date) return;
      const desc=e.description||'';
      if(isNonExpense(desc)) return;
      const raw=+(e.amount||0);
      const amt = raw<0 ? -raw : 0;
      if(amt<=0) return;
      flat.push({date:e.date, amount:amt, category:e.category||w.name, walletName:w.name, source:'Wallet'});
    });
  });

  // Legacy bills paid
  (billsLegacy||[]).forEach(b=>{
    if(!b.paid) return;
    const when=b.paidAt || b.dueDate; if(!when) return;
    const amt=+(b.amount||0)||0; if(amt<=0) return;
    flat.push({date:when, amount:amt, category:b.title||'Bill', walletName:'Bill', source:'Bill'});
  });

  // Payables history (all; Home calendar shows by month — we’ll include all and month filter later)
  (payables||[]).forEach(p=>{
    (p.history||[]).forEach(h=>{
      const when=h.date || p.lastPaidDate; if(!when) return;
      const amt=+(h.amount ?? p.amount ?? 0)||0; if(amt<=0) return;
      flat.push({date:when, amount:amt, category:p.category||'Bill', walletName:p.name||'Payable', source:h.source==='wallet'?'Wallet':'Total'});
    });
  });

  // Total-balance expenses
  (ledger||[]).forEach(r=>{
    if((r.type||'').toUpperCase()==='TOTAL_EXPENSE'){
      const amt=+(r.amount||0)||0; if(amt<=0) return;
      flat.push({date:r.date, amount:amt, category:r.category||'Expense', walletName:'Total Balance', source:'Total'});
    }
  });

  // Daily/Monthly rollups
  const dailyTotals={}; const dailyByCategory={}; const monthlyTotals={};
  const now=new Date(); let todaySpendTotal=0; let thisMonthSpend=0;
  const sameDay=(a,b)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
  const sameMonth=(a,b)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth();

  flat.forEach(t=>{
    const d=new Date(t.date); if(isNaN(d)) return;
    const k=ymd(d); const mk=monthKey(d);
    dailyTotals[k]=(dailyTotals[k]||0)+t.amount;
    monthlyTotals[mk]=(monthlyTotals[mk]||0)+t.amount;
    if(!dailyByCategory[k]) dailyByCategory[k]={};
    dailyByCategory[k][t.category]=(dailyByCategory[k][t.category]||0)+t.amount;
    if(sameDay(d,now)) todaySpendTotal+=t.amount;
    if(sameMonth(d,now)) thisMonthSpend+=t.amount;
  });

  // Per-wallet budget usage for this month (+ include bills if flag)
  const budgetWallets=[]; let globalUsed=0;
  const globalCap = +(budgets?.global?.totalCap||0)||null;

  for(const w of wallets){
    const tiles=normalizeWalletTiles(w.tiles||[]);
    let used=0;

    (w.expenses||[]).forEach(e=>{
      if(!e?.date || monthKey(e.date)!==THIS_MONTH) return;
      const desc=e.description||''; if(isNonExpense(desc)) return;
      const raw=+(e.amount||0); const amt = raw<0? -raw:0;
      if(amt<=0) return;
      used += amt; canonicalizeCategory(e.category||'Others', tiles);
    });

    if(includeBills){
      (billsLegacy||[])
        .filter(bb=>bb.paid && (bb.paidAt||bb.dueDate) && monthKey(bb.paidAt||bb.dueDate)===THIS_MONTH && bb.walletId===w.id)
        .forEach(bb=>{ used += +(bb.amount||0)||0; });
    }

    globalUsed += used;
    const cap = +(budgets?.byWallet?.[w.id]?.walletCap ?? w.monthlyCap ?? 0) || null;
    const remaining = cap ? Math.max(0, cap-used) : null;
    const pct = cap ? Math.round((used/cap)*100) : 0;
    budgetWallets.push({ id:w.id, name:w.name, cap, used, remaining, pct });
  }

  const overspentWallets = budgetWallets.filter(w=>w.cap && w.used>w.cap).map(w=>({
    name:w.name, used:w.used, cap:w.cap, over:w.used-w.cap
  }));

  const budgetGlobal={};
  if(globalCap){
    budgetGlobal.totalCap=globalCap;
    budgetGlobal.usedTotal=globalUsed;
    budgetGlobal.remainingTotal=Math.max(0,globalCap-globalUsed);
    budgetGlobal.pct=Math.round((globalUsed/globalCap)*100);
  }

  // Totals across all time (for snapshot row)
  let totalWalletSpendAll=0; let totalBillsPaidAll=0;
  wallets.forEach(w=>{
    (w.expenses||[]).forEach(e=>{
      const desc=e.description||''; if(isNonExpense(desc)) return;
      const raw=+(e.amount||0); const amt = raw<0? -raw:0;
      if(amt>0) totalWalletSpendAll += amt;
    });
  });
  (billsLegacy||[]).forEach(b=>{ if(b.paid) totalBillsPaidAll += +(b.amount||0)||0; });
  (payables||[]).forEach(p=>{ (p.history||[]).forEach(h=>{ const v=+(h.amount ?? p.amount ?? 0)||0; if(v>0) totalBillsPaidAll+=v; }); });

  // Savings goals summary
  const rawGoals=(await getData('savings_goals_v1'))||[];
  const savingsGoalsSummary = rawGoals.map(g=>{
    const target = +(g.target || g.amount || 0);
    const saved = +(g.progress || g.saved || 0);
    const balance = Math.max(0, target - saved);
    const monthlyPlan = +(g.monthlyPlan || g.planAmount || g.plan?.amountPerMonth || 0);
    const deadline = g.deadline || g.plan?.deadline || null;

    // derive months remaining
    let monthsRemaining = null;
    if (monthlyPlan > 0) {
      monthsRemaining = Math.max(0, Math.ceil(balance / monthlyPlan));
    } else if (deadline) {
      const end = new Date(deadline);
      const now = new Date();
      if (!isNaN(end)) {
        monthsRemaining = Math.max(0, (end.getFullYear()-now.getFullYear())*12 + (end.getMonth()-now.getMonth()) + 1);
      }
    }

    return { name:g.name||'Goal', target, saved, balance, monthlyPlan, monthsRemaining, deadline };
  });

  const lastMonthKey = prevMonthKey(THIS_MONTH);
  const lastMonthSpend = +(monthlyTotals[lastMonthKey]||0);

  return {
    totalBalance,
    totalWalletSpendAll,
    totalBillsPaidAll,
    thisMonthSpend,
    todaySpendTotal,
    wallets: wallets.map(w=>({ id:w.id, name:w.name, balance:+(w.balance||0) })),
    dailyTotals,
    dailyByCategory,
    monthlyTotals,
    lastMonthSpend,
    lastMonthKey,
    budgetWallets,
    budgetGlobal,
    overspentWallets,
    savingsGoalsSummary,
  };
}

// For any month key
export async function getSpendForMonth(mkey){
  if(!mkey) return 0;
  const aggs=await computeAggregates();
  return +(aggs.monthlyTotals?.[mkey]||0);
}

// ---------- Prompt blocks for AI ----------
export async function buildContextBlocks({ q='', k=6 }={}){
  const aggs = await computeAggregates();
  const peso = (n)=>`₱${Number(n||0).toLocaleString(undefined,{maximumFractionDigits:2})}`;

  const lines=[];
  lines.push('--- SUMMARY ---');
  lines.push(`TotalBalance: ${peso(aggs.totalBalance)}`);
  lines.push(`Today Expense: ${peso(aggs.todaySpendTotal)}`);
  lines.push(`ThisMonth (${THIS_MONTH}) Expense: ${peso(aggs.thisMonthSpend)}`);
  lines.push(`LastMonth (${aggs.lastMonthKey}) Expense: ${peso(aggs.lastMonthSpend)}`);
  lines.push('');

  // month ladder
  lines.push('MonthTotals (last 6):');
  for(let i=0;i<6;i++){
    const mk=addMonthsKey(THIS_MONTH,-i);
    lines.push(`- ${mk}: ${peso(+(aggs.monthlyTotals?.[mk]||0))}`);
  }
  lines.push('');

  // budgets
  lines.push('Budgets::PerWallet (This month)');
  if((aggs.budgetWallets||[]).length){
    aggs.budgetWallets.forEach(w=>{
      const capStr = w.cap ? `${w.cap}` : 'none';
      const remStr = w.cap ? `${Math.max(0,w.cap-w.used)}` : 'n/a';
      lines.push(`- name="${w.name}" cap=${capStr} used=${w.used} remaining=${remStr} pct=${w.cap?Math.round((w.used/w.cap)*100):0}`);
    });
  } else {
    lines.push('(no wallet caps)');
  }
  lines.push('');
  lines.push('Budgets::Global (This month)');
  if(aggs.budgetGlobal?.totalCap){
    lines.push(`totalCap=${aggs.budgetGlobal.totalCap} used=${aggs.budgetGlobal.usedTotal} remaining=${aggs.budgetGlobal.remainingTotal} pct=${aggs.budgetGlobal.pct}`);
  } else {
    lines.push('(no global cap)');
  }
  lines.push('');

  // savings goals
  lines.push('--- SAVINGS GOALS ---');
  if((aggs.savingsGoalsSummary||[]).length){
    aggs.savingsGoalsSummary.forEach(g=>{
      lines.push(`- name="${g.name}" target=${g.target} saved=${g.saved} balance=${g.balance} monthlyPlan=${g.monthlyPlan||0} monthsRemaining=${g.monthsRemaining??'n/a'} due="${g.deadline||'n/a'}"`);
    });
  } else {
    lines.push('(none)');
  }
  lines.push('');

  // overspend flags
  if((aggs.overspentWallets||[]).length){
    lines.push('--- OVERSPENT ---');
    aggs.overspentWallets.forEach(o=>{
      lines.push(`- ${o.name}: used=${o.used} cap=${o.cap} over=${o.over}`);
    });
    lines.push('');
  }

  const summaryBlock = lines.join('\n');

  // matches from KB
  const matches = await searchRag(q, { k });
  let matchesBlock = '--- RAG MATCHES ---\n(none)';
  if(matches.length){
    matchesBlock = [
      `--- RAG MATCHES (top-${k}) ---`,
      ...matches.map((m,i)=>`${i+1}. ${m.title || m.category || 'Item'} :: ${peso(m.amount)} on ${m.date} (${m.wallet || 'Wallet'} • ${m.category || 'General'})`)
    ].join('\n');
  }

  return { summaryBlock, matchesBlock, aggregates: aggs };
}

// ---------- Yesterday snapshot ----------
export async function getYesterdaySnapshot(){
  const aggs=await computeAggregates();
  const y=new Date(); y.setDate(y.getDate()-1);
  const key=ymd(y);
  const total=+(aggs.dailyTotals?.[key]||0);
  const cats=aggs.dailyByCategory?.[key]||{};
  const topCat=Object.entries(cats).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'General';
  return { total, topCategory: topCat };
}

// convenience wrapper
export async function searchRag(query,{k=6,walletId=null}={}){
  const scored=await querySimilar(query||'',{topK:k,walletId});
  return scored.map(({doc,score})=>({
    id:doc.id, score, title:doc.text?.slice(0,60), amount:+(doc.amount||0), date:doc.date,
    walletId:doc.walletId, wallet:doc.walletName, category:doc.category, kind:doc.kind, source:doc.source,
    extra:doc.extra||null,
  }));
}
