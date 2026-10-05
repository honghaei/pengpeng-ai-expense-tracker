// src/screens/ProfileScreen.js
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal, Alert, Image, Platform,
  KeyboardAvoidingView, Keyboard, TouchableWithoutFeedback,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import Svg, { Circle } from 'react-native-svg';
import { WebView } from 'react-native-webview';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { palette, gradients, radius, spacing, shadow } from '../theme/design';

import { getData, saveData } from '../utils/storage';
import { seedPortfolioDemoData, clearPortfolioDemoData } from '../utils/portfolioDemoData';
import { getTotalBalance, adjustTotalBalance } from '../utils/ledger';

import {
  getGoals, normalizeGoal, computeStats,
  createGoal, updateGoal,
} from '../utils/goals';

import {
  exportAndPersistMonthlyReport,
} from '../utils/report';

const peso = (n)=>`₱${Number(n||0).toLocaleString(undefined,{maximumFractionDigits:0})}`;
const pad = (n)=>String(n).padStart(2,'0');
const ymKey = (y,m)=>`${y}-${pad(m+1)}`;
const ymLabel=(y,m)=>new Date(y,m,1).toLocaleString(undefined,{month:'long',year:'numeric'});

// Donut (paid progress in blue)
const Donut=({progress=0,size=132,strokeWidth=12,color=palette.primary})=>{
  const pct=Math.max(0,Math.min(1,progress));
  const r=(size-strokeWidth)/2;
  const c=2*Math.PI*r;
  const offset=c*(1-pct);
  return (
    <View style={{width:size,height:size}}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={size/2} cy={size/2} r={r} stroke={palette.hairline} strokeWidth={strokeWidth} fill="none"/>
        <Circle cx={size/2} cy={size/2} r={r} stroke={color} strokeWidth={strokeWidth} fill="none"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`} />
      </Svg>
      <View style={styles.donutCenter}><Text style={styles.donutPct}>{Math.round(pct*100)}%</Text></View>
    </View>
  );
};

// helpers
const today = new Date();
const nowYMKey = ymKey(today.getFullYear(), today.getMonth());
const sumPaid = (sch=[]) =>
  sch.reduce((s,row)=> s + Number(row.paid ?? (row.confirmed ? (row.amountPlanned ?? row.amount ?? 0) : 0)), 0);

const parseAmt = (v) => {
  const clean = String(v ?? '').replace(/[₱,\s]/g, '');
  const n = Number(clean);
  return Number.isFinite(n) ? n : 0;
};

// === GOAL ↔ WALLET helpers ===
const GOAL_WALLET_ID = (g) =>
  g?.goalWalletId || (g?.id ? `goal:${g.id}` : null);

/** Ensure there's a dedicated wallet for this goal (named after the goal). */
const ensureGoalWallet = async (goal) => {
  const wallets = (await getData('wallets')) || [];
  const name = (goal?.name || 'Goal').trim();
  const id = GOAL_WALLET_ID(goal) || `goal:${name.toLowerCase().replace(/\s+/g, '-')}`;

  let w = wallets.find((x) => x.id === id) || wallets.find((x) => x.name === name);
  if (!w) {
    w = { id, name, balance: 0, expenses: [] };
    await saveData('wallets', [...wallets, w]);
  }
  return w.id;
};

// === AUTO-SYNC: Recompute a goal's plan from its dedicated wallet balance ===
// We treat the goal wallet *balance* as the ground truth for "amount saved".

const SYNC_pad2 = (n) => String(n).padStart(2, '0');
const SYNC_now = new Date();
const SYNC_NOW_YM = `${SYNC_now.getFullYear()}-${SYNC_pad2(SYNC_now.getMonth() + 1)}`;

const SYNC_rowIsPaid = (r) => {
  const planned = Number(r?.amountPlanned ?? r?.amount ?? 0);
  const paid = Number(r?.paid || 0);
  return paid + 1e-6 >= planned;
};

const SYNC_getCurrentRowIdx = (schedule = []) => {
  let i = schedule.findIndex((r) => (r.date || '').slice(0, 7) === SYNC_NOW_YM);
  if (i === -1) i = schedule.findIndex((r) => !SYNC_rowIsPaid(r));
  if (i === -1) i = 0;
  return i;
};


/** Re-solve schedule so cumulative paid equals the goal wallet's balance. */
const syncGoalWithWalletBalance = async (goal) => {
  if (!goal?.id) return goal;

  const wallets = (await getData('wallets')) || [];

  // 1) Find the goal wallet:
  //    a) by id (goal.goalWalletId)
  //    b) if not found, by *name* (wallet name equals goal name, case/space-insensitive)
  const wantedName = (goal.name || '').trim().toLowerCase();
  let gw =
    wallets.find((w) => w.id === goal.goalWalletId) ||
    wallets.find((w) => (w.name || '').trim().toLowerCase() === wantedName);

  if (!gw) return goal;

  // If we matched by name but goal isn't linked yet, persist the link now.
  if (!goal.goalWalletId || goal.goalWalletId !== gw.id) {
    try {
      await updateGoal(goal.id, { goalWalletId: gw.id });
      goal = { ...goal, goalWalletId: gw.id };
    } catch {}
  }

  const totalSaved = Math.max(0, Number(gw.balance || 0));

  const sch = Array.isArray(goal.schedule)
    ? goal.schedule.map((r) => ({
        ...r,
        amountPlanned: Number(r.amountPlanned ?? r.amount ?? 0),
        paid: Number(r.paid || 0),
        confirmed: !!r.confirmed,
      }))
    : [];
  if (!sch.length) return goal;

  // 2) Fill "paid" from the wallet balance, row-by-row from the start
  let remaining = totalSaved;
  for (let i = 0; i < sch.length; i++) {
    const planned = Number(sch[i].amountPlanned || 0);
    const pay = Math.min(planned, remaining);
    sch[i].paid = pay;
    sch[i].confirmed = pay + 1e-6 >= planned;
    remaining -= pay;
  }

  // 3) If over-saved, reduce upcoming planned amounts starting from the current row
  if (remaining > 0) {
    const pad2 = (n) => String(n).padStart(2, '0');
    const now = new Date();
    const NOW_YM = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
    const rowIsPaid = (r) => Number(r.paid || 0) + 1e-6 >= Number(r.amountPlanned || 0);

    let curIdx = sch.findIndex((r) => (r.date || '').slice(0, 7) === NOW_YM);
    if (curIdx === -1) curIdx = sch.findIndex((r) => !rowIsPaid(r));
    if (curIdx === -1) curIdx = 0;

    for (let i = curIdx; i < sch.length && remaining > 0; i++) {
      const beforePlan = Number(sch[i].amountPlanned || 0);
      const unpaidNow = Math.max(0, beforePlan - Number(sch[i].paid || 0));
      if (unpaidNow > 0) {
        const reduce = Math.min(remaining, unpaidNow);
        sch[i].amountPlanned = Math.max(0, beforePlan - reduce);
        sch[i].amount = sch[i].amountPlanned;
        if ((sch[i].paid || 0) + 1e-6 >= sch[i].amountPlanned) sch[i].confirmed = true;
        remaining -= reduce;
      }
    }
  }

  // 4) Mirror planned -> amount for safety
  sch.forEach((r) => {
    if (typeof r.amountPlanned === 'number') r.amount = r.amountPlanned;
  });

  // 5) Persist only if changed
  const changed =
    JSON.stringify((goal.schedule || []).map((r) => ({
      date: r.date,
      amountPlanned: Number(r.amountPlanned ?? r.amount ?? 0),
      paid: Number(r.paid || 0),
      confirmed: !!r.confirmed,
    }))) !==
    JSON.stringify(sch.map((r) => ({
      date: r.date,
      amountPlanned: r.amountPlanned,
      paid: r.paid,
      confirmed: r.confirmed,
    })));

  if (changed) {
    const updated = await updateGoal(goal.id, { schedule: sch, goalWalletId: goal.goalWalletId || gw.id }).catch(() => null);
    return updated || { ...goal, schedule: sch, goalWalletId: goal.goalWalletId || gw.id };
  }
  return goal;
};


/** Sync ALL goals that have a goalWalletId to their wallet balances, return the up-to-date array. */
const syncAllGoalsWithWallets = async (goalsArr) => {
  const res = [];
  for (const g of goalsArr || []) {
    if (g?.goalWalletId) res.push(await syncGoalWithWalletBalance(g));
    else res.push(g);
  }
  return res;
};


/** Credit a wallet (deposit) with a transfer-style row so *not* counted as expense. */
const creditGoalWallet = async (walletId, amount, goalName) => {
  const ws = (await getData('wallets')) || [];
  const i = ws.findIndex((x) => x.id === walletId);
  if (i === -1) return;
  const w = ws[i];
  const val = Math.abs(Number(amount) || 0);
  w.balance = Number(w.balance || 0) + val;
  w.expenses = Array.isArray(w.expenses) ? w.expenses : [];
  w.expenses.push({
    id: `goal-in-${walletId}-${Date.now()}`,
    amount: val, // positive deposit
    date: new Date().toISOString(),
    category: `Goal Wallet: ${goalName}`,
    description: `Wallet transfer (in) — Goal: ${goalName}`,
  });
  ws[i] = w;
  await saveData('wallets', ws);
};

/** Debit a *source* wallet with a transfer-style row so *not* counted as expense. */
const debitSourceWalletTransfer = async (walletId, amount, goalName) => {
  const ws = (await getData('wallets')) || [];
  const i = ws.findIndex((x) => x.id === walletId);
  if (i === -1) return { ok: false, reason: 'wallet_not_found' };

  const w = ws[i];
  const need = Math.abs(Number(amount) || 0);
  if (Number(w.balance || 0) < need) return { ok: false, reason: 'insufficient_wallet' };

  w.balance = Number(w.balance || 0) - need;
  w.expenses = Array.isArray(w.expenses) ? w.expenses : [];
  w.expenses.push({
    id: `goal-out-${walletId}-${Date.now()}`,
    amount: -need, // negative (debit)
    date: new Date().toISOString(),
    category: `Goal Transfer: ${goalName}`,
    description: `Wallet transfer (out) — Goal: ${goalName}`,
  });

  ws[i] = w;
  await saveData('wallets', ws);
  return { ok: true };
};

// Build equal plan rows
const buildEqualSchedule = (startY, startM, months, total, from, walletId) => {
  const rows=[];
  const m = Math.max(1, Number(months||1));
  const base = Math.floor((Number(total||0)/m)*100)/100;
  for(let i=0;i<m;i++){
    const d = new Date(startY, startM + i, 1);
    const planned = base;
    rows.push({
      date:`${d.getFullYear()}-${pad(d.getMonth()+1)}-01`,
      label: ymLabel(d.getFullYear(), d.getMonth()),
      amountPlanned: planned,
      amount: planned,      // legacy mirror
      paid: 0,
      confirmed:false,
      from, walletId: walletId || null,
    });
  }
  const sum=rows.reduce((s,r)=>s+Number(r.amountPlanned||0),0);
  const diff=Number(total||0)-sum;
  if(rows.length && Math.abs(diff)>=0.01) {
    rows[rows.length-1].amountPlanned += diff;
    rows[rows.length-1].amount += diff;
  }
  return rows;
};

// status helpers
const isRowPaid = (row) => {
  const planned = Number(row?.amountPlanned ?? row?.amount ?? 0);
  const paid = Number(row?.paid || 0);
  return paid + 1e-6 >= planned;
};
const getCurrentIdx = (sch) => {
  let i = sch.findIndex(r => (r.date || '').slice(0,7) === nowYMKey);
  if (i === -1) i = sch.findIndex(r => !isRowPaid(r));
  if (i === -1) i = 0;
  return i;
};

export default function ProfileScreen(){
  const navigation = useNavigation();

  const [profile,setProfile]=useState({name:'', avatarUri:''});
  const [wallets,setWallets]=useState([]);
  const [goals,setGoals]=useState([]);
  const [expandedId,setExpandedId]=useState(null);

  // goal modal
  const [modalVisible,setModalVisible]=useState(false);
  const [editingGoal,setEditingGoal]=useState(null);

  // finished summary
  const [finishedSummary,setFinishedSummary]=useState(null);

  // report viewer
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [pdfHtml, setPdfHtml] = useState(null);
  const [pdfFileUri, setPdfFileUri] = useState(null);
  const [pdfName, setPdfName] = useState(null);

  // load all
  const loadAll = useCallback(async ()=>{
    const p=(await getData('user_profile'))||{};
    setProfile({name:p.name||'', avatarUri: p.avatarUri || ''});

    // wallets first (for chips)
    const walletsRaw = (await getData('wallets')) || [];
    setWallets(walletsRaw.map(w=>({id:w.id,name:w.name,balance:Number(w.balance||0)})));

    // goals -> normalize -> SYNC WITH WALLET BALANCES -> set
    const arr = await getGoals();
    const safe = (Array.isArray(arr)?arr:[]).map(normalizeGoal);

    // ⛳️ NEW: recompute each goal's plan from its *goal wallet* balance
    const synced = await syncAllGoalsWithWallets(safe);

    setGoals(synced);

    const {ongoing} = computeStats(synced);
    if(!expandedId && ongoing.length) setExpandedId(ongoing[0].id);
  },[expandedId]);


  // Recompute every time the screen gets focus (tab switch, back from Wallet, etc.)
useFocusEffect(
  useCallback(() => {
    loadAll();
  }, [loadAll])
);


  const {ongoing,finished}=useMemo(()=>computeStats(goals||[]),[goals]);
  useEffect(()=>{
    if(!expandedId) return;
    const exp=(ongoing||[]).find(g=>g.id===expandedId);
    if(!exp && ongoing.length) setExpandedId(ongoing[0].id);
    if(!exp && ongoing.length===0) setExpandedId(null);
  },[ongoing,expandedId]);

  const goEditProfile = ()=> navigation.navigate('ProfileOnboarding',{mode:'edit'});

  // Open App Tour
  const openAppTour = () => {
    const rootNav = navigation.getParent?.()?.getParent?.();
    if (rootNav?.navigate) rootNav.navigate('AppTour');
    else navigation.navigate('AppTour');
  };

  // avatar
  const pickAvatar = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Permission needed','Allow photo library access to set your avatar.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
        allowsEditing: true,
        aspect: [1,1],
      });
      if (res.canceled) return;
      const uri = res.assets?.[0]?.uri;
      if (!uri) return;
      const p = (await getData('user_profile')) || {};
      p.avatarUri = uri;
      await saveData('user_profile', p);
      setProfile(s => ({ ...s, avatarUri: uri }));
    } catch (e) {
      Alert.alert('Avatar error', String(e?.message || e));
    }
  };

  // goals (open/edit)
  const openNewGoal = ()=>{
    setEditingGoal({ id:null, name:'', target:'', months:'3', from:'total', walletId:null });
    setModalVisible(true);
  };
  const openEditGoal = (g)=>{
    setEditingGoal({
      id:g.id, name:g.name, target:String(g.target||0),
      months:String(g.months||g.schedule?.length||1),
      from:g.deductFrom||g.schedule?.[0]?.from||'total',
      walletId:g.schedule?.[0]?.walletId||null,
    });
    setModalVisible(true);
  };
  const onChangeField = (key) => (t) => setEditingGoal(s => ({ ...s, [key]: t }));

  // save (edit/new) — auto-create & link goal wallet on create
  const saveGoalFromModal = async ()=>{
    const {id,name,target,months,from,walletId}=editingGoal||{};
    if(!name?.trim()||!Number(target)||!Number(months)){
      Alert.alert('Missing info','Please fill goal name, target and months.'); return;
    }

    try{
      if(id){
        // ----- update existing goal (unchanged schedule-carry logic) -----
        const old = goals.find(x=>x.id===id);
        const oldSch = Array.isArray(old?.schedule) ? old.schedule : [];
        const firstDate = oldSch[0]?.date ? new Date(oldSch[0].date) : new Date();
        const startY = firstDate.getFullYear();
        const startM = firstDate.getMonth();

        const mCount = Math.max(1, Number(months));
        const baseRows = buildEqualSchedule(startY, startM, mCount, Number(target), from, walletId);

        let remainingPaid = oldSch.reduce((s,r)=>{
          const planned = Number(r.amountPlanned ?? r.amount ?? 0);
          const paid = Number(r.paid ?? (r.confirmed ? planned : 0)) || 0;
          return s + paid;
        }, 0);

        const newRows = baseRows.map(r=>({ ...r }));
        for (let i=0;i<newRows.length;i++){
          const planned = Number(newRows[i].amountPlanned || 0);
          if (remainingPaid <= 0) break;
          const apply = Math.min(remainingPaid, planned);
          newRows[i].paid = apply;
          const remainingPlanned = Math.max(0, planned - apply);
          newRows[i].amountPlanned = remainingPlanned;
          newRows[i].amount = remainingPlanned;
          newRows[i].confirmed = remainingPlanned <= 1e-6;
          remainingPaid -= apply;
        }
        newRows.forEach(r=>{ r.paid = Number(r.paid || 0); });

        const updated=await updateGoal(id,{
          name:name.trim(),
          target:Number(target),
          months:mCount,
          deductFrom: from,
          schedule: newRows,
          carryCredit: Number(old?.carryCredit || 0) + Math.max(0, remainingPaid),
        });

        setGoals(prev=>prev.map(x=>x.id===id?(updated || { ...x, name:name.trim(), target:Number(target), months:mCount, deductFrom: from, schedule:newRows }):x));
        await loadAll();
      }else{
        // ----- create new goal -----
        const start = new Date();
        const rows = buildEqualSchedule(
          start.getFullYear(),
          start.getMonth(),
          Number(months),
          Number(target),
          from,
          walletId
        );
        const created = await createGoal({
          name: name.trim(),
          target: Number(target),
          months: Number(months),
          deductFrom: from,
          schedule: rows,
          carryCredit: 0,
        });

        // ✅ auto-create & link a wallet for this goal (by goal name)
        const goalWalletId = await ensureGoalWallet(created);
        await updateGoal(created.id, { goalWalletId });

        setGoals((prev) => [created, ...prev]);
        setExpandedId(created.id);
        await loadAll();
      }
    }catch(e){ Alert.alert('Failed to save goal',String(e?.message||e)); }
    finally{ setModalVisible(false); }
  };

  // --- Derive goal plan values from its linked wallet balance (no persistence) ---
const derivePlanFromWallet = (goal, wallets, nowYMKey) => {
  if (!goal) return null;
  const wanted = (goal.name || '').trim().toLowerCase();

  // Find the wallet either by stored id or by name fallback
  const gw =
    (goal.goalWalletId && (wallets || []).find(w => w.id === goal.goalWalletId)) ||
    (wallets || []).find(w => (w.name || '').trim().toLowerCase() === wanted);

  if (!gw) return null;

  const saved = Math.max(0, Number(gw.balance || 0));
  const sch = Array.isArray(goal.schedule)
    ? goal.schedule.map(r => ({
        ...r,
        amountPlanned: Number(r.amountPlanned ?? r.amount ?? 0),
        dateKey: (r.date || '').slice(0, 7),
      }))
    : [];

  let remaining = saved;
  let plannedThisMonth = 0;
  let paidThisMonth = 0;

  for (let i = 0; i < sch.length; i++) {
    const planned = Number(sch[i].amountPlanned || 0);
    const pay = Math.min(planned, remaining);
    if (sch[i].dateKey === nowYMKey) {
      plannedThisMonth = planned;
      paidThisMonth = pay;
    }
    remaining -= pay;
  }

  return { saved, plannedThisMonth, paidThisMonth };
};

// --- Derive the WHOLE schedule from the linked wallet balance (UI only, no persistence)
const deriveScheduleFromWallet = (goal, wallets) => {
  if (!goal) return [];

  const wanted = (goal.name || '').trim().toLowerCase();
  const gw =
    (goal.goalWalletId && (wallets || []).find(w => w.id === goal.goalWalletId)) ||
    (wallets || []).find(w => (w.name || '').trim().toLowerCase() === wanted);
  if (!gw) return Array.isArray(goal.schedule) ? goal.schedule : [];

  const saved = Math.max(0, Number(gw.balance || 0));

  // normalize source rows
  const rows = Array.isArray(goal.schedule)
    ? goal.schedule.map(r => ({
        label: r.label || r.date,
        date: r.date,
        dateKey: (r.date || '').slice(0, 7),
        planned: Number(r.amountPlanned ?? r.amount ?? 0),
        paid: 0,
        confirmed: !!r.confirmed,
      }))
    : [];

  if (!rows.length) return rows;

  // 1) Pay rows in order using wallet balance
  let remaining = saved;
  for (let i = 0; i < rows.length; i++) {
    const pay = Math.min(rows[i].planned, remaining);
    rows[i].paid = pay;
    rows[i].confirmed = pay + 1e-6 >= rows[i].planned;
    remaining -= pay;
  }

  // 2) If still extra saved, reduce upcoming planned amounts starting from current row
  const pad2 = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const NOW_YM = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  const isPaidRow = (r) => Number(r.paid || 0) + 1e-6 >= Number(r.planned || 0);

  let curIdx = rows.findIndex(r => r.dateKey === NOW_YM);
  if (curIdx === -1) curIdx = rows.findIndex(r => !isPaidRow(r));
  if (curIdx === -1) curIdx = 0;

  if (remaining > 0) {
    for (let i = curIdx; i < rows.length && remaining > 0; i++) {
      const unpaid = Math.max(0, rows[i].planned - rows[i].paid);
      if (unpaid > 0) {
        const reduce = Math.min(remaining, unpaid);
        rows[i].planned = Math.max(0, rows[i].planned - reduce);
        if (rows[i].paid + 1e-6 >= rows[i].planned) rows[i].confirmed = true;
        remaining -= reduce;
      }
    }
  }
  return rows;
};


  // checkbox toggle — move funds as wallet transfers; no await inside Array.map
  const onToggleMonth = async (g,idx)=>{
    const row=Array.isArray(g.schedule)?g.schedule[idx]:null; if(!row) return;

    // ordering guards (as you had)
    const schGuard = (g.schedule || []).map(r => ({
      ...r,
      amountPlanned: r.amountPlanned ?? r.amount ?? 0,
      paid: Number(r.paid || 0),
    }));
    const curIdx = getCurrentIdx(schGuard);
    if (!isRowPaid(schGuard[curIdx]) && idx > curIdx) {
      Alert.alert('Finish current month first', 'Please complete the current month before marking a future month.');
      return;
    }
    const firstUnpaid = schGuard.findIndex(r => !isRowPaid(r));
    if (firstUnpaid !== -1 && idx > firstUnpaid) {
      Alert.alert('Earlier month unpaid', 'Please complete earlier months in order.');
      return;
    }

    const planned = Number(row.amountPlanned ?? row.amount ?? 0);
    const alreadyPaid = Number(row.paid || 0);
    const due = Math.max(0, planned - alreadyPaid);
    const willCheck=!row.confirmed;

    try{
      // --- move the money ONCE (wallet transfer semantics) ---
      if (willCheck) {
        if (due > 0) {
          const goalWalletId = await ensureGoalWallet(g);

          if ((row.from || g.deductFrom) === 'total') {
            const totalNow = Number(await getTotalBalance()) || 0;
            if (totalNow < due) {
              Alert.alert('Not enough Total Balance', `Need ${peso(due)}, available ${peso(totalNow)}.`);
              return;
            }
            await adjustTotalBalance(-due);                // Total → out
            await creditGoalWallet(goalWalletId, due, g.name); // Goal wallet → in (transfer)
          } else {
            const wid = row.walletId || g.deductFrom;
            const res = await debitSourceWalletTransfer(wid, due, g.name); // Source wallet → out (transfer)
            if (!res.ok) {
              if (res.reason === 'insufficient_wallet') {
                const allW = (await getData('wallets')) || [];
                const w = allW.find(x => x.id === wid);
                Alert.alert('Insufficient funds', `${w?.name || 'Wallet'} has only ${peso(w?.balance || 0)}.`);
              } else {
                Alert.alert('Wallet not found', 'Pick a valid wallet in Plan.');
              }
              return;
            }
            await creditGoalWallet(goalWalletId, due, g.name); // Goal wallet → in (transfer)
          }
        }
      } else {
        const refund = Math.min(alreadyPaid, planned);
        if (refund > 0) {
          const goalWalletId = await ensureGoalWallet(g);
          // 1) debit goal wallet (transfer OUT)
          const ws = (await getData('wallets')) || [];
          const gi = ws.findIndex(x => x.id === goalWalletId);
          if (gi !== -1) {
            const gw = ws[gi];
            gw.balance = Number(gw.balance || 0) - refund;
            gw.expenses = Array.isArray(gw.expenses) ? gw.expenses : [];
            gw.expenses.push({
              id: `goal-undo-out-${goalWalletId}-${Date.now()}`,
              amount: -refund,
              date: new Date().toISOString(),
              category: `Goal Wallet: ${g.name}`,
              description: `Wallet transfer (out, undo) — Goal: ${g.name}`,
            });
            ws[gi] = gw;
            await saveData('wallets', ws);
          }
          // 2) credit back to source
          if ((row.from || g.deductFrom) === 'total') {
            await adjustTotalBalance(+refund);
          } else {
            const wid = row.walletId || g.deductFrom;
            await creditGoalWallet(wid, refund, `Undo from Goal: ${g.name}`); // Source wallet → in (transfer)
          }
        }
      }

      // --- update the schedule (no awaits here) ---
      const sch = g.schedule.map((r,i)=>{
        if(i!==idx) return r;
        const plannedNow = Number(r.amountPlanned ?? r.amount ?? 0);
        const paidNow = Number(r.paid || 0);

        if (willCheck) {
          const newPaid = paidNow + due;
          return {
            ...r,
            paid: newPaid,
            confirmed: newPaid + 1e-6 >= plannedNow,
          };
        } else {
          const refund = Math.min(alreadyPaid, plannedNow);
          const newPaid = Math.max(0, paidNow - refund);
          return {
            ...r,
            paid: newPaid,
            confirmed: newPaid + 1e-6 >= plannedNow,
          };
        }
      });
      sch.forEach(r => { if (typeof r.amountPlanned === 'number') r.amount = r.amountPlanned; });

      const updatedGoal=await updateGoal(g.id,{ schedule: sch });
      setGoals(prev=>prev.map(x=>x.id===g.id?(updatedGoal||{...x,schedule:sch}):x));

      await loadAll();
    }catch(e){ Alert.alert('Error',String(e?.message||e)); }
  };

  const payThisMonth = useCallback(async (g, rawAmt) => {
    let entered = parseAmt(rawAmt);
    if (entered <= 0) { Alert.alert('Enter amount', 'Please type a positive amount.'); return false; }

    const sch = Array.isArray(g.schedule) ? g.schedule.map(r => ({
      ...r,
      amountPlanned: Number(r.amountPlanned ?? r.amount ?? 0),
      paid: Number(r.paid || 0),
    })) : [];
    if (!sch.length) return false;

    const idx = getCurrentIdx(sch);
    const current = sch[idx];

    // ensure wallet
    const goalWalletId = await ensureGoalWallet(g);

    const sourceKind = (current.from || g.deductFrom) === 'total' ? 'total' : 'wallet';
    if (sourceKind === 'total') {
      const totalNow = Number(await getTotalBalance()) || 0;
      if (totalNow < entered) {
        Alert.alert('Not enough Total Balance', `Need ${peso(entered)}, available ${peso(totalNow)}.`);
        return false;
      }
      await adjustTotalBalance(-entered);
      await creditGoalWallet(goalWalletId, entered, g.name);
    } else {
      const wid = current.walletId || g.deductFrom;
      const res = await debitSourceWalletTransfer(wid, entered, g.name);
      if (!res.ok) {
        Alert.alert('Insufficient funds', 'Not enough in wallet');
        return false;
      }
      await creditGoalWallet(goalWalletId, entered, g.name);
    }

    // update schedule
    const currentPaidBefore = Number(current.paid || 0);
    current.paid = currentPaidBefore + entered;
    const plannedNow = Number(current.amountPlanned || 0);
    if (current.paid + 1e-6 >= plannedNow) current.confirmed = true;

    const over = Math.max(0, current.paid - plannedNow);
    if (over > 0 && idx + 1 < sch.length) {
      const next = sch[idx + 1];
      const beforePlan = Number(next.amountPlanned || 0);
      if (beforePlan > 0) {
        const reduceBy = Math.min(over, beforePlan);
        next.amountPlanned = Math.max(0, beforePlan - reduceBy);
        next.amount = next.amountPlanned;
      }
    }
    sch.forEach(r => { if (typeof r.amountPlanned === 'number') r.amount = r.amountPlanned; });

    const updated = await updateGoal(g.id, { schedule: sch, goalWalletId });
    setGoals(prev => prev.map(x => x.id === g.id ? (updated || { ...x, schedule: sch, goalWalletId }) : x));

    await loadAll();
    return true;
  }, [loadAll]);

  // ===== Monthly Report (unchanged UI) =====
  const repYearInit = today.getFullYear();
  const repMonthInit = today.getMonth();
  const [repYear, setRepYear] = useState(repYearInit);
  const [repMonth, setRepMonth] = useState(repMonthInit);

  const openViewer = (meta, titleFallback) => {
    setPdfHtml(meta?.html || '<html><body><p style="padding:12px;color:#111">No HTML snapshot saved.</p></body></html>');
    setPdfFileUri(meta?.fileUri || null);
    setPdfName(meta?.name || titleFallback || 'Monthly Report');
    setPdfModalOpen(true);
  };

  const handleReportCta = async ()=>{
    const now = new Date();
    const isCurrent = repYear === now.getFullYear() && repMonth === now.getMonth();
    if (isCurrent) {
      try {
        const res = await exportAndPersistMonthlyReport(repYear, repMonth);
        await saveData(`report:${ymKey(repYear,repMonth)}`, { html: res.html, fileUri: res.fileUri, name: res.name, data: res.data });
        openViewer(res, res?.name);
      } catch (e) {
        Alert.alert('Report error', String(e?.message || e));
      }
    } else {
      const meta = (await getData(`report:${ymKey(repYear,repMonth)}`)) || null;
      if (meta?.html || meta?.fileUri) {
        openViewer(meta, meta?.name || `MonthlyReport_${ymKey(repYear,repMonth)}.pdf`);
      } else {
        Alert.alert(
          'No saved report',
          `No saved report for ${ymLabel(repYear,repMonth)}. Generate one now?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Generate', style: 'default', onPress: async ()=>{
                try {
                  const res = await exportAndPersistMonthlyReport(repYear, repMonth);
                  await saveData(`report:${ymKey(repYear,repMonth)}`, { html: res.html, fileUri: res.fileUri, name: res.name, data: res.data });
                  openViewer(res, res?.name);
                } catch (e) {
                  Alert.alert('Report error', String(e?.message || e));
                }
              } }
          ]
        );
      }
    }
  };

  const GoalCard=({g})=>{
    const [payInput, setPayInput] = useState('');

    const schedule = Array.isArray(g.schedule) ? g.schedule : [];
const target = Number(g.target || 0);

// 🔄 Derive from the linked wallet if available; otherwise fall back to schedule
const derived = useMemo(() => derivePlanFromWallet(g, wallets, nowYMKey), [g, wallets]);
const savedLocal = derived ? derived.saved : sumPaid(schedule);
const balance  = Math.max(target - savedLocal, 0);
const progress = target > 0 ? savedLocal / target : 0;

// Build a fully derived schedule for UI (from wallet balance)
const derivedSchedule = useMemo(
  () => deriveScheduleFromWallet(g, wallets),
  [g, wallets]
);

// Compute this month from the derived schedule so table and header always match
let plannedThisMonth = 0, paidThisMonth = 0;
const rowNow = derivedSchedule.find(r => (r.date || '').slice(0,7) === nowYMKey);
if (rowNow) {
  plannedThisMonth = Number(rowNow.planned || 0);
  paidThisMonth    = Number(rowNow.paid || 0);
} else if (derived) {
  // fallback to previously derived numbers if schedule has no current-row
  plannedThisMonth = derived.plannedThisMonth;
  paidThisMonth    = derived.paidThisMonth;
}



    const submitPay = () => {
      const v = (payInput || '').trim();
      if (!v) return;
      payThisMonth(g, v).then(()=> {
        setPayInput('');
        Keyboard.dismiss();
      });
    };

    return (
      <View style={styles.goalCard}>
        <View style={{flexDirection:'row', alignItems:'flex-start'}}>
          <View style={{flex:1}}>
            <Text style={styles.goalTitle}>{g.name}</Text>

            <Text style={styles.kvLabel}>Target amount</Text>
            <Text style={[styles.kvValue,{color:palette.primaryStrong}]}>{peso(target)}</Text>

            <Text style={styles.kvLabel}>Amount saved</Text>
            <Text style={[styles.kvValue,{color:palette.success}]}>{peso(savedLocal)}</Text>

            <Text style={styles.kvLabel}>Balance</Text>
            <Text style={[styles.kvValue,{color:palette.warn}]}>{peso(balance)}</Text>
          </View>

          <View style={{alignItems:'center',justifyContent:'center'}}>
            <Donut progress={progress} />
            <TouchableOpacity style={styles.planBtn} onPress={()=>openEditGoal(g)}>
              <Text style={styles.planBtnText}>Edit plan</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Monthly planned/paid header */}
        <View style={{ flexDirection:'row', justifyContent:'space-between', marginTop:12 }}>
          <View>
            <Text style={styles.kvLabel}>Planned this month</Text>
            <Text style={[styles.kvValue, { color:palette.primaryStrong}]}>{peso(plannedThisMonth)}</Text>
          </View>
          <View>
            <Text style={styles.kvLabel}>Paid this month</Text>
            <Text style={[styles.kvValue, { color:palette.success}]}>{peso(paidThisMonth)}</Text>
          </View>
        </View>

        {/* Pay this month */}
        <View style={styles.payRow}>
          <TextInput
            style={styles.payInput}
            placeholder="Pay this month (₱)"
            placeholderTextColor={palette.muted}
            keyboardType="numeric"
            value={payInput}
            onChangeText={setPayInput}
            returnKeyType="done"
            blurOnSubmit={false}
            onSubmitEditing={submitPay}
          />
          <TouchableOpacity style={styles.payBtn} onPress={submitPay} activeOpacity={0.9}>
            <Text style={styles.payBtnTxt}>Pay</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.progressLabel}>Goal progress</Text>
        <View style={styles.progressTrack}><View style={[styles.progressFill,{width:`${Math.min(100,progress*100)}%`}]} /></View>

        {/* Schedule table */}
        <View style={styles.table}>
          <View style={styles.trHead}>
            <Text style={[styles.th,{flex:2}]}>Date</Text>
            <Text style={[styles.th,{flex:1,textAlign:'right'}]}>Planned</Text>
            <Text style={[styles.th,{flex:1,textAlign:'right'}]}>Paid</Text>
            <Text style={[styles.th,{width:70,textAlign:'center'}]}>Status</Text>
          </View>
          {derivedSchedule.map((row, idx) => (
  <View key={`${g.id}-${idx}`} style={styles.tr}>
    <Text style={[styles.td,{flex:2}]}>{row.label || row.date}</Text>
    <Text style={[styles.td,{flex:1,textAlign:'right'}]}>{peso(Number(row.planned || 0))}</Text>
    <Text style={[styles.td,{flex:1,textAlign:'right', color:palette.success}]}>{peso(Number(row.paid || 0))}</Text>
    <View style={[styles.checkbox, row.confirmed && styles.checkboxOn]}>
      {row.confirmed ? <Text style={styles.checkmark}>✓</Text> : null}
    </View>
  </View>
))}

        </View>
      </View>
    );
  };

  const GoalTile=({g,onPress})=>{
    const schedule=Array.isArray(g.schedule)?g.schedule:[];
    const savedLocal = sumPaid(schedule);
    const pct=Math.round((savedLocal/Math.max(1,g.target||1))*100);
    return (
      <TouchableOpacity style={styles.tile} onPress={onPress}>
        <Text style={styles.tileName} numberOfLines={1}>{g.name}</Text>
        <Text style={styles.tilePct}>{pct}%</Text>
      </TouchableOpacity>
    );
  };

  const expanded = expandedId ? (ongoing||[]).find(g=>g.id===expandedId) : null;


  const loadPortfolioDemo = async () => {
    Alert.alert(
      'Load portfolio demo data?',
      'This replaces the local financial data on this device with realistic demo data for screenshots and testing.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Load demo',
          onPress: async () => {
            try {
              await seedPortfolioDemoData();
              await load();
              Alert.alert(
                'Demo ready',
                'Portfolio demo data was loaded. Reopen the other tabs to refresh their values.'
              );
            } catch (e) {
              Alert.alert('Could not load demo', String(e?.message || e));
            }
          },
        },
      ]
    );
  };

  const clearPortfolioDemo = async () => {
    Alert.alert(
      'Clear local demo data?',
      'This removes the demo financial data from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearPortfolioDemoData();
              await load();
              Alert.alert('Cleared', 'The local demo data was removed.');
            } catch (e) {
              Alert.alert('Could not clear data', String(e?.message || e));
            }
          },
        },
      ]
    );
  };

  // UI
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.screenContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.profileIntro}>
        <View>
          <Text style={styles.eyebrow}>PROFILE</Text>
          <Text style={styles.pageTitle}>Your financial space</Text>
        </View>

        <TouchableOpacity
          onPress={openAppTour}
          style={styles.tourButton}
          activeOpacity={0.84}
        >
          <Ionicons name="compass-outline" size={18} color={palette.cyan} />
        </TouchableOpacity>
      </View>

      <LinearGradient
        colors={['#10356C', '#205FD1', '#4A7CFF']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerCard}
      >
        <View style={styles.profileIdentity}>
          <TouchableOpacity
            onPress={pickAvatar}
            activeOpacity={0.85}
            accessibilityLabel="Change profile photo"
          >
            {profile.avatarUri ? (
              <Image source={{ uri: profile.avatarUri }} style={styles.avatarImg} />
            ) : (
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarInitial}>
                  {(profile.name || 'R')[0].toUpperCase()}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          <View style={styles.profileCopy}>
            <Text style={styles.profileLabel}>PERSONAL FINANCE PROFILE</Text>
            <Text style={styles.name}>{profile.name || 'Your Profile'}</Text>
            <Text style={styles.profileHint}>
              Your goals, reports, and money preferences live here.
            </Text>
          </View>
        </View>

        <View style={styles.btnRow}>
          <TouchableOpacity
            onPress={goEditProfile}
            style={[styles.editBtn, styles.halfBtn]}
            activeOpacity={0.86}
          >
            <Ionicons name="create-outline" size={16} color="#fff" />
            <Text style={styles.editBtnText}>Edit profile</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={openAppTour}
            style={[styles.guideBtn, styles.halfBtn]}
            activeOpacity={0.86}
          >
            <Ionicons name="play-circle-outline" size={16} color="#DDEBFF" />
            <Text style={styles.guideBtnText}>App tour</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionEyebrow}>SAVINGS</Text>
          <Text style={styles.sectionTitle}>Goals that matter</Text>
        </View>

        <TouchableOpacity
          onPress={openNewGoal}
          style={styles.addGoalBtn}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={17} color={palette.bgDeep} />
          <Text style={styles.addGoalText}>New goal</Text>
        </TouchableOpacity>
      </View>

      {expanded ? (
        <GoalCard g={expanded} />
      ) : (
        <View style={styles.emptyGoal}>
          <View style={styles.emptyGoalIcon}>
            <Ionicons name="flag-outline" size={27} color={palette.cyan} />
          </View>
          <Text style={styles.emptyGoalTitle}>No active savings goal</Text>
          <Text style={styles.empty}>
            Set a target, choose a timeline, and Pengpeng can help you understand the progress.
          </Text>
          <TouchableOpacity
            onPress={openNewGoal}
            style={styles.emptyGoalAction}
            activeOpacity={0.85}
          >
            <Text style={styles.emptyGoalActionText}>Create your first goal</Text>
            <Ionicons name="arrow-forward" size={15} color={palette.cyan} />
          </TouchableOpacity>
        </View>
      )}

      {(ongoing || [])
        .filter((g) => g.id !== expanded?.id)
        .map((g) => (
          <GoalTile
            key={g.id}
            g={g}
            onPress={() => setExpandedId(g.id)}
          />
        ))}

      {(finished || []).length > 0 && (
        <View style={styles.completedSection}>
          <Text style={styles.completedTitle}>Completed goals</Text>
          {finished.map((g) => (
            <GoalTile
              key={g.id}
              g={g}
              onPress={() => setFinishedSummary(g)}
            />
          ))}
        </View>
      )}

      <View style={styles.reportCard}>
        <View style={styles.reportHeadingRow}>
          <View style={styles.reportIcon}>
            <Ionicons name="document-text-outline" size={20} color={palette.cyan} />
          </View>

          <View style={styles.reportHeadingCopy}>
            <Text style={styles.sectionEyebrow}>MONTHLY REPORT</Text>
            <Text style={styles.reportTitle}>Your month in numbers</Text>
          </View>
        </View>

        <Text style={styles.reportSubtitle}>
          Review spending, balances, and account activity in a shareable financial snapshot.
        </Text>

        <View style={styles.reportScrollerRow}>
          <TouchableOpacity
            onPress={() => {
              const d = new Date(repYear, repMonth, 1);
              d.setMonth(d.getMonth() - 1);
              setRepYear(d.getFullYear());
              setRepMonth(d.getMonth());
            }}
            style={styles.arrowBtn}
            activeOpacity={0.82}
          >
            <Ionicons name="chevron-back" size={19} color={palette.textSoft} />
          </TouchableOpacity>

          <View style={styles.reportMonthCopy}>
            <Text style={styles.reportMonthCaption}>Selected month</Text>
            <Text style={styles.reportMonthLabel}>
              {ymLabel(repYear, repMonth)}
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => {
              const d = new Date(repYear, repMonth, 1);
              d.setMonth(d.getMonth() + 1);
              const now = new Date();
              const future =
                d.getFullYear() > now.getFullYear() ||
                (d.getFullYear() === now.getFullYear() &&
                  d.getMonth() > now.getMonth());

              if (future) {
                Alert.alert('Future month', 'That month hasn’t happened yet.');
                return;
              }

              setRepYear(d.getFullYear());
              setRepMonth(d.getMonth());
            }}
            style={styles.arrowBtn}
            activeOpacity={0.82}
          >
            <Ionicons name="chevron-forward" size={19} color={palette.textSoft} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={handleReportCta}
          style={styles.reportCTA}
          activeOpacity={0.88}
        >
          <Text style={styles.reportCTATxt}>
            {repYear === today.getFullYear() &&
            repMonth === today.getMonth()
              ? 'Generate this month'
              : 'Open saved report'}
          </Text>
          <Ionicons name="arrow-forward" size={16} color="#fff" />
        </TouchableOpacity>
      </View>


      {__DEV__ ? (
        <View style={styles.demoTools}>
          <View style={styles.demoToolsHeader}>
            <Ionicons name="construct-outline" size={16} color={palette.primaryStrong} />
            <View style={styles.demoToolsCopy}>
              <Text style={styles.demoToolsTitle}>Portfolio demo tools</Text>
              <Text style={styles.demoToolsText}>
                Development only. Load realistic sample finances for testing and screenshots.
              </Text>
            </View>
          </View>

          <View style={styles.demoToolsActions}>
            <TouchableOpacity
              onPress={loadPortfolioDemo}
              style={styles.demoLoadBtn}
              activeOpacity={0.85}
            >
              <Ionicons name="sparkles-outline" size={15} color={palette.bgDeep} />
              <Text style={styles.demoLoadText}>Load demo data</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={clearPortfolioDemo}
              style={styles.demoClearBtn}
              activeOpacity={0.85}
            >
              <Text style={styles.demoClearText}>Clear</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* Modals */}
      <Modal transparent visible={modalVisible} animationType="fade" onRequestClose={()=>setModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>{editingGoal?.id?'Edit Goal':'New Goal'}</Text>

              <Text style={styles.modalLabel}>Goal name</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., Emergency Fund"
                placeholderTextColor={palette.muted}
                value={editingGoal?.name||''}
                onChangeText={onChangeField('name')}
                returnKeyType="done"
              />

              <Text style={styles.modalLabel}>Target amount</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                placeholder="30000"
                placeholderTextColor={palette.muted}
                value={editingGoal?.target??''}
                onChangeText={onChangeField('target')}
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
                blurOnSubmit={false}
              />

              <Text style={styles.modalLabel}>Months</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                placeholder="3"
                placeholderTextColor={palette.muted}
                value={editingGoal?.months??'3'}
                onChangeText={onChangeField('months')}
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
                blurOnSubmit={false}
              />

              <Text style={styles.modalLabel}>Deduct from</Text>
              <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
                <TouchableOpacity onPress={()=>setEditingGoal(s=>({...s,from:'total',walletId:null}))}
                  style={[styles.chip, editingGoal?.from==='total' && styles.chipOn]}><Text style={styles.chipText}>Total Balance</Text></TouchableOpacity>
                {wallets.map(w=>(
                  <TouchableOpacity key={w.id} onPress={()=>setEditingGoal(s=>({...s,from:w.id, walletId:w.id}))}
                    style={[styles.chip, editingGoal?.from===w.id && styles.chipOn]}><Text style={styles.chipText}>{w.name}</Text></TouchableOpacity>
                ))}
              </View>

              <View style={{flexDirection:'row',justifyContent:'flex-end',marginTop:14}}>
                <TouchableOpacity style={[styles.smallBtn,{backgroundColor:palette.surface3}]} onPress={()=>setModalVisible(false)}>
                  <Text style={{color:'#fff'}}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.smallBtn,{backgroundColor:palette.primary,marginLeft:8}]} onPress={saveGoalFromModal}>
                  <Text style={{color:'#fff',fontWeight:'700'}}>Save goal</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      <Modal transparent visible={!!finishedSummary} animationType="fade" onRequestClose={()=>setFinishedSummary(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>🎉 Goal Completed</Text>
            <Text style={styles.summaryLine}><Text style={styles.summaryKey}>Name:</Text> {finishedSummary?.name}</Text>
            <Text style={styles.summaryLine}><Text style={styles.summaryKey}>Total Amount:</Text> {peso(finishedSummary?.target)}</Text>
            <Text style={styles.summaryLine}><Text style={styles.summaryKey}>Duration:</Text> {(finishedSummary?.schedule||[]).length} month(s)</Text>
            {!!finishedSummary?.finishedAt && (
              <Text style={styles.summaryLine}><Text style={styles.summaryKey}>Finished:</Text> {new Date(finishedSummary.finishedAt).toLocaleDateString()}</Text>
            )}
            <TouchableOpacity style={[styles.smallBtn,{backgroundColor:palette.primary,alignSelf:'flex-end',marginTop:14}]}
              onPress={()=>setFinishedSummary(null)}>
              <Text style={{color:'#fff',fontWeight:'800'}}>Nice!</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={pdfModalOpen} animationType="fade" onRequestClose={()=>setPdfModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard,{width:'94%', maxHeight:'86%'}]}>
            <Text style={styles.modalTitle}>{pdfName || 'Monthly Report'}</Text>
            <View style={{height:460, borderWidth:1, borderColor:palette.borderStrong, borderRadius:10, overflow:'hidden', marginTop:8}}>
              {pdfHtml ? (
                <WebView
                  originWhitelist={['*']}
                  source={{ html: pdfHtml }}
                  javaScriptEnabled
                />
              ) : (
                <Text style={{color:'#F5F7FB', padding:12}}>No preview available.</Text>
              )}
            </View>

            <View style={{flexDirection:'row', justifyContent:'flex-end', marginTop:12}}>
              <TouchableOpacity style={[styles.smallBtn,{backgroundColor:palette.bgSoft, marginRight:8, borderWidth:1, borderColor:palette.borderStrong}]} onPress={async ()=>{
                if (!pdfFileUri) {
                  Alert.alert('Open PDF', 'There is no PDF file for this snapshot yet.');
                  return;
                }
                if (await Sharing.isAvailableAsync()) {
                  await Sharing.shareAsync(pdfFileUri);
                } else {
                  Alert.alert('Path', pdfFileUri);
                }
              }}>
                <Text style={{color:'#F5F7FB', fontWeight:'800'}}>Open/Share PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.smallBtn,{backgroundColor:palette.primary}]} onPress={()=>setPdfModalOpen(false)}>
                <Text style={{color:'#fff', fontWeight:'800'}}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

// styles
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.bg,
  },

  screenContent: {
    paddingHorizontal: spacing.l,
    paddingTop: 8,
    paddingBottom: 116,
  },

  profileIntro: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },

  eyebrow: {
    color: palette.cyan,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 4,
  },

  pageTitle: {
    color: palette.text,
    fontSize: 27,
    lineHeight: 32,
    fontWeight: '900',
    letterSpacing: -0.65,
  },

  pageSubtitle: {
    color: palette.sub,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
  },

  tourButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.borderStrong,
  },

  headerCard: {
    borderRadius: 28,
    padding: 20,
    overflow: 'hidden',
    ...shadow(9, 0.22),
  },

  profileIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  profileCopy: {
    flex: 1,
    marginLeft: 14,
  },

  profileLabel: {
    color: '#C8DEFF',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginBottom: 4,
  },

  name: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.45,
  },

  profileHint: {
    color: '#C4D8F5',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
    maxWidth: 270,
  },

  avatarImg: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.38)',
  },

  avatarCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.34)',
  },

  avatarInitial: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 24,
  },

  btnRow: {
    flexDirection: 'row',
    marginTop: 18,
  },

  halfBtn: {
    flex: 1,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },

  editBtn: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    marginRight: 8,
  },

  editBtnText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 12,
    marginLeft: 6,
  },

  guideBtn: {
    backgroundColor: 'rgba(5,21,52,0.28)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },

  guideBtnText: {
    color: '#DDEBFF',
    fontWeight: '800',
    fontSize: 12,
    marginLeft: 6,
  },

  sectionHeader: {
    marginTop: 28,
    marginBottom: 13,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },

  sectionEyebrow: {
    color: palette.primaryStrong,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.35,
    marginBottom: 4,
  },

  sectionTitle: {
    color: palette.text,
    fontSize: 23,
    lineHeight: 28,
    fontWeight: '900',
    letterSpacing: -0.4,
  },

  addGoalBtn: {
    minHeight: 38,
    paddingHorizontal: 13,
    borderRadius: radius.pill,
    backgroundColor: palette.cyan,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },

  addGoalText: {
    color: palette.bgDeep,
    fontWeight: '900',
    fontSize: 11,
    marginLeft: 3,
  },

  emptyGoal: {
    paddingVertical: 24,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: palette.hairline,
  },

  emptyGoalIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.cyanSoft,
    marginBottom: 13,
  },

  emptyGoalTitle: {
    color: palette.text,
    fontSize: 18,
    fontWeight: '900',
  },

  empty: {
    color: palette.sub,
    marginTop: 6,
    lineHeight: 19,
    fontSize: 12,
    maxWidth: 330,
  },

  emptyGoalAction: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    alignSelf: 'flex-start',
  },

  emptyGoalActionText: {
    color: palette.cyan,
    fontSize: 12,
    fontWeight: '900',
    marginRight: 6,
  },

  goalCard: {
    backgroundColor: palette.surface,
    borderRadius: 26,
    padding: 18,
    borderWidth: 1,
    borderColor: palette.borderStrong,
  },

  goalTitle: {
    color: palette.text,
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 9,
    letterSpacing: -0.4,
  },

  kvLabel: {
    color: palette.sub,
    marginTop: 4,
    fontSize: 10,
    fontWeight: '700',
  },

  kvValue: {
    color: palette.text,
    fontWeight: '900',
    fontSize: 17,
    marginTop: 1,
    marginBottom: 3,
  },

  planBtn: {
    marginTop: 8,
    minHeight: 34,
    paddingHorizontal: 13,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    backgroundColor: palette.bgSoft,
    justifyContent: 'center',
  },

  planBtnText: {
    color: palette.textSoft,
    fontWeight: '800',
    fontSize: 10,
  },

  progressLabel: {
    color: palette.textSoft,
    marginTop: 14,
    marginBottom: 6,
    fontWeight: '800',
    fontSize: 10,
  },

  progressTrack: {
    height: 7,
    borderRadius: 999,
    backgroundColor: palette.hairline,
    overflow: 'hidden',
  },

  progressFill: {
    height: '100%',
    backgroundColor: palette.cyan,
    borderRadius: 999,
  },

  donutCenter: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },

  donutPct: {
    color: palette.text,
    fontWeight: '900',
    fontSize: 17,
  },

  payRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 13,
  },

  payInput: {
    flex: 1,
    backgroundColor: palette.bgSoft,
    color: palette.text,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: radius.l,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginRight: 8,
    fontSize: 12,
  },

  payBtn: {
    backgroundColor: palette.primary,
    borderRadius: radius.pill,
    paddingVertical: 11,
    paddingHorizontal: 17,
  },

  payBtnTxt: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 11,
  },

  table: {
    marginTop: 15,
    borderTopWidth: 1,
    borderColor: palette.hairline,
  },

  trHead: {
    flexDirection: 'row',
    paddingVertical: 10,
  },

  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: palette.hairline,
  },

  th: {
    color: palette.muted,
    fontWeight: '900',
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  td: {
    color: palette.textSoft,
    fontSize: 11,
  },

  checkbox: {
    width: 25,
    height: 25,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },

  checkboxOn: {
    backgroundColor: palette.success,
    borderColor: palette.success,
  },

  checkmark: {
    color: palette.bgDeep,
    fontWeight: '900',
  },

  tile: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
    paddingVertical: 13,
  },

  tileName: {
    color: palette.textSoft,
    fontWeight: '800',
    flex: 1,
    marginRight: 8,
  },

  tilePct: {
    color: palette.cyan,
    fontWeight: '900',
  },

  completedSection: {
    marginTop: 22,
  },

  completedTitle: {
    color: palette.text,
    fontSize: 16,
    fontWeight: '900',
    marginBottom: 5,
  },

  reportCard: {
    marginTop: 30,
    paddingTop: 23,
    borderTopWidth: 1,
    borderTopColor: palette.hairline,
  },

  reportHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  reportIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: palette.cyanSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 11,
  },

  reportHeadingCopy: {
    flex: 1,
  },

  reportTitle: {
    color: palette.text,
    fontSize: 21,
    fontWeight: '900',
    letterSpacing: -0.35,
  },

  reportSubtitle: {
    color: palette.sub,
    fontSize: 12,
    lineHeight: 19,
    marginTop: 12,
    maxWidth: 480,
  },

  reportScrollerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: palette.hairline,
  },

  arrowBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: palette.bgSoft,
    borderWidth: 1,
    borderColor: palette.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },

  arrowTxt: {
    color: palette.textSoft,
    fontSize: 17,
    fontWeight: '900',
  },

  reportMonthCopy: {
    flex: 1,
    alignItems: 'center',
  },

  reportMonthCaption: {
    color: palette.muted,
    fontSize: 8,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },

  reportMonthLabel: {
    color: palette.text,
    fontWeight: '900',
    fontSize: 16,
    marginTop: 2,
  },

  reportCTA: {
    minHeight: 46,
    borderRadius: radius.pill,
    backgroundColor: palette.primary,
    marginTop: 14,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },

  reportCTATxt: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 12,
    marginRight: 7,
  },


  demoTools: {
    marginTop: 28,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: palette.hairline,
  },

  demoToolsHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },

  demoToolsCopy: {
    flex: 1,
    marginLeft: 9,
  },

  demoToolsTitle: {
    color: palette.text,
    fontSize: 12,
    fontWeight: '900',
  },

  demoToolsText: {
    color: palette.sub,
    fontSize: 9,
    lineHeight: 14,
    marginTop: 3,
  },

  demoToolsActions: {
    flexDirection: 'row',
    marginTop: 12,
  },

  demoLoadBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: radius.pill,
    backgroundColor: palette.cyan,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },

  demoLoadText: {
    color: palette.bgDeep,
    fontSize: 10,
    fontWeight: '900',
    marginLeft: 5,
  },

  demoClearBtn: {
    minWidth: 76,
    minHeight: 42,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    backgroundColor: palette.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  demoClearText: {
    color: palette.textSoft,
    fontSize: 10,
    fontWeight: '800',
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: palette.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },

  modalCard: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: palette.elevated,
    padding: spacing.l,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: palette.borderStrong,
  },

  modalTitle: {
    color: palette.text,
    fontSize: 20,
    fontWeight: '900',
    marginBottom: 8,
  },

  modalLabel: {
    color: palette.textSoft,
    marginTop: 12,
    marginBottom: 6,
    fontWeight: '800',
    fontSize: 11,
  },

  input: {
    backgroundColor: palette.bgSoft,
    color: palette.text,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: radius.l,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },

  chip: {
    backgroundColor: palette.surface2,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
  },

  chipOn: {
    backgroundColor: palette.primarySoft,
    borderColor: palette.primary,
  },

  chipText: {
    color: palette.textSoft,
    fontSize: 11,
    fontWeight: '700',
  },

  smallBtn: {
    borderRadius: radius.pill,
    paddingVertical: 10,
    paddingHorizontal: 15,
  },

  summaryLine: {
    color: palette.textSoft,
    marginTop: 8,
    lineHeight: 19,
  },

  summaryKey: {
    color: palette.sub,
    fontWeight: '800',
  },
});
