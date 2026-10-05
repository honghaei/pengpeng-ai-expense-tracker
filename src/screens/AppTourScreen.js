// src/screens/AppTourScreen.js
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import PengpengAvatar from '../components/PengpengAvatar';

import { saveData } from '../utils/storage';
import {
  palette,
  gradients,
  radius,
  spacing,
  shadow,
} from '../theme/design';

const money = (n) =>
  `₱${Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;

const STEPS = [
  {
    section: 'Welcome',
    page: 'welcome',
    target: 'mascot',
    title: 'Meet Pengpeng, your smart expense companion.',
    body:
      'Pengpeng brings your balances, wallets, bills, goals, reports, and spending insights together in one personalized money system.',
    detail:
      'This tour uses miniature copies of the real screens. The glowing FOCUS marker shows exactly which control or feature is being explained.',
  },

  // Navigation
  {
    section: 'Navigation',
    page: 'home',
    target: 'tabs',
    title: 'Five main areas, one financial system.',
    body:
      'The bottom navigation moves between Overview, Wallets, Bills, Pengpeng AI, and Profile. Each area handles a different part of your money instead of forcing everything into one screen.',
    detail:
      'Use Overview for daily monitoring, Wallets for allocation, Bills for due payments, Pengpeng AI for analysis, and Profile for goals, reports, and settings.',
  },

  // Home
  {
    section: 'Overview',
    page: 'home',
    target: 'balance',
    title: 'Start with your financial snapshot.',
    body:
      'The Total Balance card gives you the main picture first: available money, spending this month, today’s spending, and the recent spending trend.',
    detail:
      'This is your quick health check before you decide whether to spend, move money, or adjust a budget.',
  },
  {
    section: 'Overview',
    page: 'home',
    target: 'addCash',
    title: 'Add cash without leaving the dashboard.',
    body:
      'Tap the + button in Total Balance to add money. You can send it to Total Balance or directly into a wallet.',
    detail:
      'Use this for new cash, allowance, salary adjustments, reimbursements, or any manual balance correction.',
  },
  {
    section: 'Overview',
    page: 'home',
    target: 'calendar',
    title: 'See spending by day.',
    body:
      'View Calendar opens a monthly expense calendar so you can spot which days had spending and compare daily totals.',
    detail:
      'Internal transfers, deposits, and withdrawals are not treated as spending, so the calendar focuses on actual expenses.',
  },
  {
    section: 'Overview',
    page: 'home',
    target: 'categories',
    title: 'Monitor budget categories instantly.',
    body:
      'The category circles show how much of each wallet budget has been used this month.',
    detail:
      'Tap a category to record an expense directly against that wallet without opening the full Wallets page.',
  },
  {
    section: 'Overview',
    page: 'home',
    target: 'manage',
    title: 'Manage takes you to full wallet controls.',
    body:
      'The Manage action opens Wallets when you need more than a quick dashboard view.',
    detail:
      'That is where you can deposit, withdraw, transfer, set caps, create wallets, and configure Auto Split.',
  },
  {
    section: 'Overview',
    page: 'home',
    target: 'activity',
    title: 'Recent activity keeps changes visible.',
    body:
      'Latest Transactions surfaces your newest money movements so you can confirm that expenses and balance changes were recorded correctly.',
    detail:
      'Use this as a quick audit trail after adding cash, recording expenses, paying bills, or moving money.',
  },
  {
    section: 'Overview',
    page: 'home',
    target: 'pengpengFab',
    title: 'Pengpeng is always one tap away.',
    body:
      'The floating Pengpeng button opens your financial assistant directly from the dashboard.',
    detail:
      'Use it when you want to jump straight into Pengpeng without searching through the navigation.',
  },

  // Wallets
  {
    section: 'Wallets',
    page: 'wallets',
    target: 'summary',
    title: 'Wallets organize where your money is meant to go.',
    body:
      'The summary shows the combined amount across wallets, how many wallets you have, and how many are using monthly caps.',
    detail:
      'Wallets are spending buckets such as Food, Transport, Bills, Leisure, Health, or any custom category you create.',
  },
  {
    section: 'Wallets',
    page: 'addwallet',
    target: 'createWallet',
    title: 'Create custom wallets with their own limits.',
    body:
      'New Wallet lets you name a wallet, move an initial amount from Total Balance, and optionally set a monthly spending cap.',
    detail:
      'The starting amount is a transfer, not an expense. Setting a cap lets the dashboard and Pengpeng compare actual monthly spending against your target.',
  },
  {
    section: 'Wallets',
    page: 'wallets',
    target: 'openWallet',
    title: 'Tap a wallet for its full history.',
    body:
      'Opening a wallet shows its available balance, monthly spending, all-time spending, cap progress, and transaction history.',
    detail:
      'Use Wallet Details when you need to understand exactly what happened inside one spending category.',
  },
  {
    section: 'Wallets',
    page: 'wallets',
    target: 'deposit',
    title: 'Deposit moves money into a wallet.',
    body:
      'Deposit transfers money from Total Balance into the selected wallet.',
    detail:
      'It reallocates your money and does not count as spending.',
  },
  {
    section: 'Wallets',
    page: 'wallets',
    target: 'withdraw',
    title: 'Withdraw returns wallet money to Total Balance.',
    body:
      'Withdraw moves available funds out of a wallet and back to your main balance.',
    detail:
      'Use it when a category no longer needs as much money or you want to reallocate funds elsewhere.',
  },
  {
    section: 'Wallets',
    page: 'wallets',
    target: 'transfer',
    title: 'Transfer moves money between wallets.',
    body:
      'Transfer lets you pick another wallet and move money directly from one budget bucket to another.',
    detail:
      'This is useful when one category is running low but another still has extra funds.',
  },
  {
    section: 'Wallets',
    page: 'wallets',
    target: 'cap',
    title: 'Caps turn wallets into real monthly budgets.',
    body:
      'Set Cap gives the wallet a monthly spending limit. The progress bar then tracks how much of that limit has been used.',
    detail:
      'True expenses count toward the cap, while internal deposits, withdrawals, and transfers do not.',
  },
  {
    section: 'Wallets',
    page: 'wallets',
    target: 'autoSplit',
    title: 'Auto Split automates payday allocation.',
    body:
      'Auto Split assigns percentages of your payday income to different wallets and runs automatically on your configured payday.',
    detail:
      'Example: Food 30%, Transport 15%, Bills 25%, Savings 20%, Others 10%. Your payday income is configured in your financial profile.',
  },
  {
    section: 'Wallets',
    page: 'wallets',
    target: 'deleteWallet',
    title: 'Custom wallets can be removed safely.',
    body:
      'Swipe a custom wallet to reveal the delete action.',
    detail:
      'When a wallet is removed, its remaining balance is returned to Total Balance so the money is not lost.',
  },
  {
    section: 'Wallet Details',
    page: 'walletDetail',
    target: 'addExpense',
    title: 'Record an expense directly inside a wallet.',
    body:
      'The + button on Wallet Details opens Add Expense. Enter a description and amount, and the wallet balance is reduced.',
    detail:
      'The transaction is added to the wallet history and contributes to monthly spending and cap usage.',
  },

  // Bills
  {
    section: 'Bills',
    page: 'bills',
    target: 'billTabs',
    title: 'Bills and subscriptions are tracked separately.',
    body:
      'Switch between Bills and Subscriptions so one-time or variable obligations do not get mixed with recurring services.',
    detail:
      'Subscriptions can also use recurring controls such as Autopay and Pause.',
  },
  {
    section: 'Bills',
    page: 'bills',
    target: 'filters',
    title: 'Filter payments by status.',
    body:
      'Use All, Upcoming, Past due, and Paid to focus on the payment state you care about.',
    detail:
      'This makes the page useful both as a due-date planner and as payment history.',
  },
  {
    section: 'Bills',
    page: 'addPayable',
    target: 'addPayment',
    title: 'Add a bill or subscription with its payment source.',
    body:
      'The Add Payment screen stores the name, amount, source, next due date, and whether it is a bill or subscription.',
    detail:
      'For subscriptions you can also choose the billing frequency and enable Autopay.',
  },
  {
    section: 'Bills',
    page: 'bills',
    target: 'pay',
    title: 'Pay updates both the payment and your balance.',
    body:
      'Tap Pay when you settle a bill. The amount is deducted from the selected source and the payable record is updated.',
    detail:
      'If the chosen source does not have enough money, the app stops the payment instead of creating an invalid balance.',
  },
  {
    section: 'Subscriptions',
    page: 'bills',
    target: 'autopay',
    title: 'Autopay can handle recurring subscriptions.',
    body:
      'Autopay allows a subscription to be paid automatically when its due date arrives.',
    detail:
      'Pause temporarily stops the subscription schedule and its reminders without deleting the saved subscription.',
  },
  {
    section: 'Bills',
    page: 'bills',
    target: 'hide',
    title: 'Swipe to hide old payment records.',
    body:
      'Swipe a bill or subscription to reveal Hide.',
    detail:
      'Use this to clean the active list without treating the item like a new payment.',
  },

  // AI
  {
    section: 'Pengpeng AI',
    page: 'ai',
    target: 'aiSnapshot',
    title: 'Pengpeng starts from your actual financial snapshot.',
    body:
      'Pengpeng starts with Total Funds, Today, and This Month so the assistant always opens with your current financial picture.',
    detail:
      'This snapshot keeps the assistant grounded in the balances and spending information saved inside your app.',
  },
  {
    section: 'Pengpeng AI',
    page: 'ai',
    target: 'moneyNote',
    title: 'Today’s Note is a quick automatic insight.',
    body:
      'Today’s Note gives you a short financial observation based on your latest saved data.',
    detail:
      'Tap refresh when you want Pengpeng to reassess the latest balances and spending activity.',
  },
  {
    section: 'Pengpeng AI',
    page: 'ai',
    target: 'ask',
    title: 'Ask questions in normal language.',
    body:
      'Use Ask Pengpeng for questions about spending, budgets, bills, savings goals, wallet limits, or patterns in your recorded activity.',
    detail:
      'In Local Insights mode, Pengpeng works from the financial information stored in the app and the spending patterns calculated from it.',
  },
  {
    section: 'Pengpeng AI',
    page: 'ai',
    target: 'quickQuestions',
    title: 'Quick questions make Pengpeng easy to learn.',
    body:
      'Suggested prompts let you run useful financial checks without writing a question from scratch.',
    detail:
      'They are especially useful for first-time users who are still learning what kinds of insights the assistant can provide.',
  },
  {
    section: 'Pengpeng AI',
    page: 'ai',
    target: 'answer',
    title: 'Answers are grounded in your financial data.',
    body:
      'Pengpeng’s Insight shows the response and clearly labels when the explanation is based on your saved financial data.',
    detail:
      'The data summary below shows supporting metrics such as wallet spending, bills paid, and previous-month spending.',
  },

  // Profile
  {
    section: 'Profile',
    page: 'profile',
    target: 'editProfile',
    title: 'Your financial profile powers personalization.',
    body:
      'Edit Profile updates your name, income type, monthly income, payday automation, spending habits, and low-balance alert.',
    detail:
      'Your payday settings are also what Auto Split uses when it automatically allocates income across wallets.',
  },
  {
    section: 'Savings Goals',
    page: 'profile',
    target: 'newGoal',
    title: 'Create structured savings goals.',
    body:
      'New Goal lets you set a target, timeline, and funding source.',
    detail:
      'The app can build a monthly contribution plan and move goal contributions from Total Balance or a selected wallet into the goal balance.',
  },
  {
    section: 'Savings Goals',
    page: 'profile',
    target: 'goalPlan',
    title: 'Track each planned contribution.',
    body:
      'Goal progress is tied to a contribution schedule, so you can confirm each month as it is funded.',
    detail:
      'Checking or undoing a contribution moves the corresponding money between the source and the goal wallet, keeping the balances consistent.',
  },
  {
    section: 'Reports',
    page: 'profile',
    target: 'report',
    title: 'Generate a monthly financial report.',
    body:
      'Choose a month and generate a report that summarizes spending, balances, and account activity.',
    detail:
      'Reports can be exported as PDF and shared, giving you a portable monthly snapshot of your finances.',
  },
  {
    section: 'Profile',
    page: 'profile',
    target: 'replayTour',
    title: 'You can replay this tour anytime.',
    body:
      'The App Tour button in Profile reopens the walkthrough whenever you want a refresher.',
    detail:
      'That means the detailed guide is not limited to first-time setup.',
  },

  // Finish
  {
    section: 'Ready',
    page: 'ready',
    target: 'ready',
    title: 'You now know the full Pengpeng workflow.',
    body:
      'Track money, organize it into wallets, manage bills, build savings goals, generate reports, and use Pengpeng to understand the patterns behind your finances.',
    detail:
      'Keep your financial profile updated so Pengpeng can make wallet, payday, alert, and spending insights more relevant to you.',
  },
];

function Spot({ active, children, style }) {
  return (
    <View
      style={[
        style,
        active && styles.spotlight,
      ]}
    >
      {children}
      {active ? (
        <View style={styles.focusBadge}>
          <Text style={styles.focusBadgeText}>FOCUS</Text>
        </View>
      ) : null}
    </View>
  );
}

function MiniTabs({ active = 'Home', highlight = false }) {
  const tabs = [
    ['Home', 'home-outline'],
    ['Wallets', 'wallet-outline'],
    ['Bills', 'receipt-outline'],
    ['Pengpeng', 'pengpeng'],
    ['Profile', 'person-outline'],
  ];

  return (
    <Spot active={highlight} style={styles.miniTabBar}>
      {tabs.map(([label, icon]) => {
        const selected = active === label;
        return (
          <View key={label} style={styles.miniTab}>
            {icon === 'pengpeng' ? (
              <PengpengAvatar size={17} ring={false} />
            ) : (
              <Ionicons
                name={icon}
                size={15}
                color={selected ? palette.cyan : palette.muted}
              />
            )}
            <Text
              style={[
                styles.miniTabText,
                selected && styles.miniTabTextActive,
              ]}
            >
              {label}
            </Text>
          </View>
        );
      })}
    </Spot>
  );
}

function MockHome({ target }) {
  return (
    <View style={styles.phonePage}>
      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.mockOverline}>GOOD MORNING</Text>
          <Text style={styles.mockPageTitle}>Your Name 👋</Text>
        </View>
        <View style={styles.mockRoundButton}>
          <Ionicons name="notifications-outline" size={17} color={palette.text} />
        </View>
      </View>

      <Spot active={target === 'balance'} style={styles.spotNoClip}>
        <LinearGradient
          colors={['#0B2346', '#123E84', '#245FD7', '#338FF2']}
          style={styles.homeHero}
        >
          <View style={styles.homeHeroTop}>
            <View>
              <Text style={styles.mockHeroLabel}>TOTAL BALANCE</Text>
              <Text style={styles.mockHeroAmount}>{money(28450)}</Text>
            </View>

            <Spot active={target === 'addCash'} style={styles.roundSpot}>
              <View style={styles.heroAdd}>
                <Ionicons name="add" size={20} color="#fff" />
              </View>
            </Spot>
          </View>

          <View style={styles.homeChart}>
            <View style={[styles.chartBar, { height: 14 }]} />
            <View style={[styles.chartBar, { height: 31 }]} />
            <View style={[styles.chartBar, { height: 23 }]} />
            <View style={[styles.chartBar, { height: 39 }]} />
            <View style={[styles.chartBar, { height: 27 }]} />
            <View style={[styles.chartBar, { height: 44 }]} />
            <View style={[styles.chartBar, { height: 35 }]} />
          </View>

          <View style={styles.homeHeroFooter}>
            <View>
              <Text style={styles.mockHeroLabel}>TODAY</Text>
              <Text style={styles.mockHeroSmallAmount}>{money(320)}</Text>
            </View>

            <Spot active={target === 'calendar'} style={styles.inlineSpot}>
              <View style={styles.linkRow}>
                <Text style={styles.linkText}>View calendar</Text>
                <Ionicons name="arrow-forward" size={13} color={palette.cyan} />
              </View>
            </Spot>
          </View>
        </LinearGradient>
      </Spot>

      <View style={styles.mockSectionHeader}>
        <View>
          <Text style={styles.mockOverline}>SPENDING THIS MONTH</Text>
          <Text style={styles.mockSectionTitle}>Category breakdown</Text>
        </View>

        <Spot active={target === 'manage'} style={styles.inlineSpot}>
          <View style={styles.linkRow}>
            <Text style={styles.linkText}>Manage</Text>
            <Ionicons name="chevron-forward" size={13} color={palette.cyan} />
          </View>
        </Spot>
      </View>

      <Spot active={target === 'categories'} style={styles.budgetRow}>
        {[
          ['restaurant-outline', 'Food', '68%'],
          ['car-outline', 'Transport', '42%'],
          ['flash-outline', 'Utilities', '77%'],
          ['game-controller-outline', 'Leisure', '31%'],
        ].map(([icon, name, pct]) => (
          <View key={name} style={styles.budgetItem}>
            <View style={styles.budgetCircle}>
              <Ionicons name={icon} size={16} color={palette.cyan} />
            </View>
            <Text style={styles.budgetName}>{name}</Text>
            <Text style={styles.budgetPct}>{pct}</Text>
          </View>
        ))}
      </Spot>

      <Text style={[styles.mockOverline, { marginTop: 13 }]}>RECENT ACTIVITY</Text>
      <Text style={styles.mockSectionTitle}>Latest transactions</Text>

      <Spot active={target === 'activity'} style={styles.activityBox}>
        {[
          ['restaurant-outline', 'Lunch', '-₱280'],
          ['car-outline', 'Ride', '-₱165'],
        ].map(([icon, label, amount], i) => (
          <View key={label} style={[styles.mockRow, i === 0 && styles.mockRowBorder]}>
            <View style={styles.mockRowIcon}>
              <Ionicons name={icon} size={15} color={palette.cyan} />
            </View>
            <Text style={styles.mockRowTitle}>{label}</Text>
            <Text style={styles.mockNegative}>{amount}</Text>
          </View>
        ))}
      </Spot>

      <Spot active={target === 'pengpengFab'} style={styles.pengpengFabSpot}>
        <LinearGradient colors={gradients.primary} style={styles.pengpengFab}>
          <PengpengAvatar size={21} ring={false} />
          <Text style={styles.pengpengFabText}>Pengpeng</Text>
        </LinearGradient>
      </Spot>

      <MiniTabs active="Home" highlight={target === 'tabs'} />
    </View>
  );
}

function WalletActions({ target }) {
  const actions = [
    ['deposit', 'arrow-down-outline', 'Deposit'],
    ['withdraw', 'arrow-up-outline', 'Withdraw'],
    ['transfer', 'swap-horizontal-outline', 'Transfer'],
    ['cap', 'speedometer-outline', 'Cap'],
  ];

  return (
    <View style={styles.walletActionRow}>
      {actions.map(([key, icon, label]) => (
        <Spot
          key={key}
          active={target === key}
          style={styles.walletActionSpot}
        >
          <View style={styles.walletActionIcon}>
            <Ionicons name={icon} size={15} color={palette.cyan} />
          </View>
          <Text style={styles.walletActionText}>{label}</Text>
        </Spot>
      ))}
    </View>
  );
}

function MockWallets({ target }) {
  return (
    <View style={styles.phonePage}>
      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.mockOverline}>ACCOUNTS & BUDGETS</Text>
          <Text style={styles.mockPageTitle}>Money, organized.</Text>
        </View>

        <View style={styles.walletHeaderActions}>
          <Spot active={target === 'autoSplit'} style={styles.roundSpot}>
            <View style={styles.mockRoundButton}>
              <Ionicons name="git-compare-outline" size={17} color={palette.cyan} />
            </View>
          </Spot>
          <View style={styles.headerPlus}>
            <Ionicons name="add" size={19} color="#fff" />
          </View>
        </View>
      </View>

      <Spot active={target === 'summary'} style={styles.walletSummary}>
        <View>
          <Text style={styles.mockMeta}>Across wallets</Text>
          <Text style={styles.walletSummaryAmount}>{money(18450)}</Text>
        </View>
        <View>
          <Text style={styles.mockMeta}>Wallets</Text>
          <Text style={styles.walletSummarySmall}>6</Text>
        </View>
        <View>
          <Text style={styles.mockMeta}>With caps</Text>
          <Text style={styles.walletSummarySmall}>5</Text>
        </View>
      </Spot>

      <Text style={[styles.mockSectionTitle, { marginTop: 12, marginBottom: 7 }]}>Your wallets</Text>

      <Spot active={target === 'openWallet'} style={styles.spotNoClip}>
        <LinearGradient colors={gradients.wallet} style={styles.featuredWallet}>
          <Text style={styles.featuredWalletName}>Food & Drink</Text>
          <Text style={styles.featuredWalletLabel}>Available balance</Text>
          <Text style={styles.featuredWalletAmount}>{money(4600)}</Text>

          <View style={styles.featuredProgress}>
            <View style={[styles.featuredProgressFill, { width: '68%' }]} />
          </View>

          <WalletActions target={target} />
        </LinearGradient>
      </Spot>

      <Spot active={target === 'deleteWallet'} style={styles.secondaryWallet}>
        <View style={styles.mockRowIcon}>
          <Ionicons name="car-outline" size={15} color={palette.cyan} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.mockRowTitle}>Transport</Text>
          <Text style={styles.mockMeta}>₱1,900 spent · cap ₱4,000</Text>
        </View>
        <Text style={styles.secondaryWalletAmount}>{money(3100)}</Text>
      </Spot>

      <MiniTabs active="Wallets" />
    </View>
  );
}

function MockAddWallet({ target }) {
  return (
    <View style={styles.phonePage}>
      <Text style={styles.mockOverline}>NEW WALLET</Text>
      <Text style={styles.mockPageTitle}>Give your money a purpose.</Text>

      <LinearGradient colors={gradients.wallet} style={styles.addWalletPreview}>
        <Text style={styles.mockHeroLabel}>WALLET PREVIEW</Text>
        <Text style={styles.addWalletName}>Travel Fund</Text>
        <Text style={styles.addWalletAmount}>{money(5000)}</Text>
        <Text style={styles.addWalletMeta}>Starting balance</Text>
      </LinearGradient>

      <View style={styles.formLine}>
        <Text style={styles.formLabel}>Wallet name</Text>
        <Text style={styles.formValue}>Travel Fund</Text>
      </View>

      <View style={styles.formLine}>
        <Text style={styles.formLabel}>Initial amount</Text>
        <Text style={styles.formAmount}>₱5,000</Text>
      </View>

      <View style={styles.formLine}>
        <Text style={styles.formLabel}>Monthly spending cap</Text>
        <Text style={styles.formAmount}>₱8,000</Text>
      </View>

      <Spot active={target === 'createWallet'} style={styles.createWalletSpot}>
        <LinearGradient colors={gradients.primary} style={styles.fullPrimaryButton}>
          <Ionicons name="add-circle-outline" size={16} color="#fff" />
          <Text style={styles.fullPrimaryButtonText}>Create wallet</Text>
        </LinearGradient>
      </Spot>
    </View>
  );
}

function MockWalletDetail({ target }) {
  return (
    <View style={styles.phonePage}>
      <Text style={styles.mockOverline}>WALLET DETAILS</Text>
      <Text style={styles.mockPageTitle}>Food & Drink</Text>

      <LinearGradient colors={gradients.wallet} style={styles.detailHero}>
        <Text style={styles.mockHeroLabel}>AVAILABLE BALANCE</Text>
        <Text style={styles.detailHeroAmount}>{money(4600)}</Text>
        <View style={styles.detailStats}>
          <Text style={styles.detailStat}>This month  ₱2,400</Text>
          <Text style={styles.detailStat}>All-time  ₱18,200</Text>
        </View>
      </LinearGradient>

      <Text style={[styles.mockOverline, { marginTop: 16 }]}>ACTIVITY</Text>
      <Text style={styles.mockSectionTitle}>Transaction history</Text>

      <View style={styles.activityBox}>
        {[
          ['restaurant-outline', 'Lunch', '-₱280'],
          ['arrow-down-outline', 'Deposit', '+₱1,000'],
          ['flag-outline', 'Goal payment', '-₱500'],
        ].map(([icon, label, amt], i) => (
          <View
            key={label}
            style={[styles.mockRow, i < 2 && styles.mockRowBorder]}
          >
            <View style={styles.mockRowIcon}>
              <Ionicons name={icon} size={15} color={palette.cyan} />
            </View>
            <Text style={styles.mockRowTitle}>{label}</Text>
            <Text style={amt.startsWith('+') ? styles.mockPositive : styles.mockNegative}>
              {amt}
            </Text>
          </View>
        ))}
      </View>

      <Spot active={target === 'addExpense'} style={styles.detailFabSpot}>
        <LinearGradient colors={gradients.primary} style={styles.detailFab}>
          <Ionicons name="add" size={22} color="#fff" />
        </LinearGradient>
      </Spot>
    </View>
  );
}

function MockBills({ target }) {
  return (
    <View style={styles.phonePage}>
      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.mockOverline}>PAYMENTS</Text>
          <Text style={styles.mockPageTitle}>Bills & subscriptions</Text>
        </View>

        <View style={styles.headerPlus}>
          <Ionicons name="add" size={19} color="#fff" />
        </View>
      </View>

      <Spot active={target === 'billTabs'} style={styles.demoTabs}>
        <View style={styles.demoTabActive}>
          <Text style={styles.demoTabActiveText}>Bills</Text>
        </View>
        <Text style={styles.demoTabText}>Subscriptions</Text>
      </Spot>

      <LinearGradient
        colors={['#0D2B56', '#123D7C', '#155AA8']}
        style={styles.billSummary}
      >
        <Text style={styles.mockHeroLabel}>UPCOMING TOTAL</Text>
        <Text style={styles.billSummaryAmount}>{money(4598)}</Text>
        <Text style={styles.billSummaryMeta}>3 upcoming · 1 past due</Text>
      </LinearGradient>

      <Spot active={target === 'filters'} style={styles.filterMockRow}>
        {['All', 'Upcoming', 'Past due', 'Paid'].map((item, i) => (
          <View key={item} style={[styles.filterMock, i === 0 && styles.filterMockActive]}>
            <Text style={[styles.filterMockText, i === 0 && styles.filterMockTextActive]}>
              {item}
            </Text>
          </View>
        ))}
      </Spot>

      <View style={styles.billRows}>
        {[
          ['flash-outline', 'Electricity', 'Due Oct 12', '₱2,350'],
          ['wifi-outline', 'Internet', 'Due Oct 18', '₱1,699'],
        ].map(([icon, title, meta, amount], index) => (
          <View
            key={title}
            style={[styles.billRow, index === 0 && styles.billRowBorder]}
          >
            <View style={styles.billIcon}>
              <Ionicons name={icon} size={16} color={palette.cyan} />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={styles.mockRowTitle}>{title}</Text>
              <Text style={styles.mockMeta}>{meta}</Text>

              {index === 1 && target === 'autopay' ? (
                <Spot active style={styles.subscriptionControlMock}>
                  <Text style={styles.subscriptionControlText}>Autopay on · Pause</Text>
                </Spot>
              ) : null}
            </View>

            <View style={styles.billRight}>
              <Text style={styles.billAmount}>{amount}</Text>
              <Spot active={target === 'pay' && index === 0} style={styles.paySpot}>
                <View style={styles.payMockButton}>
                  <Text style={styles.payMockText}>Pay</Text>
                </View>
              </Spot>
            </View>
          </View>
        ))}
      </View>

      {target === 'hide' ? (
        <Spot active style={styles.hideMock}>
          <Ionicons name="trash-outline" size={15} color="#fff" />
          <Text style={styles.hideMockText}>Swipe row → Hide</Text>
        </Spot>
      ) : null}

      <MiniTabs active="Bills" />
    </View>
  );
}

function MockAddPayable({ target }) {
  return (
    <View style={styles.phonePage}>
      <Text style={styles.mockOverline}>ADD PAYMENT</Text>
      <Text style={styles.mockPageTitle}>Set it once. Stay ahead of it.</Text>

      <View style={styles.typeSwitchMock}>
        <View style={styles.typeSwitchActive}>
          <Ionicons name="receipt-outline" size={15} color={palette.cyan} />
          <Text style={styles.typeSwitchActiveText}>Bill</Text>
        </View>
        <View style={styles.typeSwitchItem}>
          <Ionicons name="repeat-outline" size={15} color={palette.sub} />
          <Text style={styles.typeSwitchText}>Subscription</Text>
        </View>
      </View>

      <View style={styles.formLine}>
        <Text style={styles.formLabel}>Bill name</Text>
        <Text style={styles.formValue}>Electricity</Text>
      </View>

      <View style={styles.formLine}>
        <Text style={styles.formLabel}>Amount</Text>
        <Text style={styles.formAmount}>₱2,350</Text>
      </View>

      <View style={styles.formLine}>
        <Text style={styles.formLabel}>Payment source</Text>
        <Text style={styles.formValue}>Utilities wallet</Text>
      </View>

      <View style={styles.formLine}>
        <Text style={styles.formLabel}>Next due date</Text>
        <Text style={styles.formValue}>Oct 12, 2026</Text>
      </View>

      <Spot active={target === 'addPayment'} style={styles.createWalletSpot}>
        <LinearGradient colors={gradients.primary} style={styles.fullPrimaryButton}>
          <Ionicons name="receipt-outline" size={16} color="#fff" />
          <Text style={styles.fullPrimaryButtonText}>Add bill</Text>
        </LinearGradient>
      </Spot>
    </View>
  );
}

function MockAI({ target }) {
  return (
    <View style={styles.phonePage}>
      <View style={styles.aiBrandRow}>
        <PengpengAvatar size={28} />
        <View style={{ flex: 1 }}>
          <Text style={styles.mockOverline}>PENGPENG AI</Text>
          <Text style={styles.aiBrandLine}>Your financial companion</Text>
        </View>
        <View style={styles.aiStatusPill}>
          <View style={styles.statusDot} />
          <Text style={styles.aiStatusText}>Local insights</Text>
        </View>
      </View>

      <Spot active={target === 'aiSnapshot'} style={styles.spotNoClip}>
        <LinearGradient colors={gradients.ai} style={styles.aiSnapshot}>
          <View style={styles.aiSnapshotTop}>
            <View>
              <Text style={styles.mockHeroLabel}>YOUR FINANCIAL SNAPSHOT</Text>
              <Text style={styles.aiAmount}>{money(28450)}</Text>
              <Text style={styles.aiSnapshotMeta}>Total funds available</Text>
            </View>
            <PengpengAvatar size={42} />
          </View>

          <View style={styles.aiStats}>
            <Text style={styles.aiStatText}>Today  ₱320</Text>
            <Text style={styles.aiStatText}>This month  ₱6,420</Text>
          </View>
        </LinearGradient>
      </Spot>

      <Spot active={target === 'moneyNote'} style={styles.moneyNoteMock}>
        <View style={styles.noteAvatarMock}>
          <PengpengAvatar size={29} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.mockOverline}>TODAY'S NOTE</Text>
          <Text style={styles.noteTextMock}>
            Food is your fastest-growing category this week.
          </Text>
        </View>
        <Ionicons name="refresh" size={15} color={palette.sub} />
      </Spot>

      <Text style={[styles.mockOverline, { marginTop: 15 }]}>ASK PENGPENG</Text>
      <Text style={styles.mockSectionTitle}>What do you want to know?</Text>

      <Spot active={target === 'ask'} style={styles.askMock}>
        <Text style={styles.askPlaceholder}>
          Ask Pengpeng about your finances…
        </Text>
        <View style={styles.askSend}>
          <Ionicons name="arrow-up" size={15} color="#fff" />
        </View>
      </Spot>

      <Spot active={target === 'quickQuestions'} style={styles.quickQuestionGrid}>
        {[
          'How much have I spent this month?',
          'Which wallet is closest to its cap?',
          'What bills are due soon?',
          'How is my savings goal doing?',
        ].map((question) => (
          <View key={question} style={styles.quickQuestion}>
            <Text style={styles.quickQuestionText}>{question}</Text>
            <Ionicons name="arrow-forward" size={10} color={palette.cyan} />
          </View>
        ))}
      </Spot>

      <Spot active={target === 'answer'} style={styles.aiAnswerMock}>
        <View style={styles.aiAnswerHeaderMock}>
          <View style={styles.aiAnswerBrand}>
            <PengpengAvatar size={24} />
            <Text style={styles.mockOverline}>PENGPENG'S INSIGHT</Text>
          </View>
          <View style={styles.dataBadge}>
            <Text style={styles.dataBadgeText}>Your data</Text>
          </View>
        </View>

        <Text style={styles.aiAnswerTitleMock}>Pengpeng's answer</Text>
        <Text style={styles.aiAnswerBodyMock}>
          Your Food wallet is using the highest share of its monthly cap.
        </Text>
      </Spot>

      <MiniTabs active="Pengpeng" />
    </View>
  );
}

function MockProfile({ target }) {
  return (
    <View style={styles.phonePage}>
      <LinearGradient
        colors={['#10356C', '#205FD1', '#4A7CFF']}
        style={styles.profileHero}
      >
        <View style={styles.profileMockTop}>
          <View style={styles.avatarMock}>
            <Text style={styles.avatarMockText}>C</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.mockHeroLabel}>PERSONAL FINANCE PROFILE</Text>
            <Text style={styles.profileMockName}>Charles</Text>
          </View>
        </View>

        <View style={styles.profileButtonRow}>
          <Spot active={target === 'editProfile'} style={styles.profileButtonSpot}>
            <View style={styles.profileButton}>
              <Ionicons name="create-outline" size={14} color="#fff" />
              <Text style={styles.profileButtonText}>Edit profile</Text>
            </View>
          </Spot>

          <Spot active={target === 'replayTour'} style={styles.profileButtonSpot}>
            <View style={styles.profileButton}>
              <Ionicons name="play-circle-outline" size={14} color="#fff" />
              <Text style={styles.profileButtonText}>App tour</Text>
            </View>
          </Spot>
        </View>
      </LinearGradient>

      <View style={styles.mockSectionHeader}>
        <View>
          <Text style={styles.mockOverline}>SAVINGS</Text>
          <Text style={styles.mockSectionTitle}>Goals that matter</Text>
        </View>

        <Spot active={target === 'newGoal'} style={styles.inlineSpot}>
          <View style={styles.newGoalMock}>
            <Ionicons name="add" size={14} color={palette.bgDeep} />
            <Text style={styles.newGoalMockText}>New goal</Text>
          </View>
        </Spot>
      </View>

      <Spot active={target === 'goalPlan'} style={styles.goalMock}>
        <View style={styles.goalMockTop}>
          <View>
            <Text style={styles.goalMockTitle}>Emergency Fund</Text>
            <Text style={styles.mockMeta}>₱18,000 of ₱30,000</Text>
          </View>
          <Text style={styles.goalPct}>60%</Text>
        </View>

        <View style={styles.goalTrack}>
          <View style={[styles.goalFill, { width: '60%' }]} />
        </View>

        <View style={styles.goalMonthRow}>
          <Text style={styles.goalMonthText}>October contribution</Text>
          <View style={styles.goalCheck}>
            <Ionicons name="checkmark" size={13} color={palette.bgDeep} />
          </View>
        </View>
      </Spot>

      <Spot active={target === 'report'} style={styles.reportMock}>
        <View style={styles.reportIconMock}>
          <Ionicons name="document-text-outline" size={16} color={palette.cyan} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.mockOverline}>MONTHLY REPORT</Text>
          <Text style={styles.mockRowTitle}>October 2026</Text>
        </View>
        <View style={styles.reportButtonMock}>
          <Text style={styles.reportButtonText}>Generate</Text>
        </View>
      </Spot>

      <MiniTabs active="Profile" />
    </View>
  );
}

function MockWelcome() {
  return (
    <View style={[styles.phonePage, styles.welcomePage]}>
      <View style={styles.welcomeGlow} />

      <View style={styles.welcomeAvatarWrap}>
        <LinearGradient colors={gradients.ai} style={styles.welcomeAvatarHalo}>
          <PengpengAvatar size={104} />
        </LinearGradient>
      </View>

      <Text style={styles.welcomeOverline}>THE SMART AI EXPENSE TRACKER</Text>
      <Text style={styles.welcomeTitle}>Meet Pengpeng.</Text>
      <Text style={styles.welcomeText}>
        A friendlier way to track your money, understand your habits, and stay
        ahead of bills, budgets, and goals.
      </Text>

      <Spot active style={styles.welcomeFeatureSpot}>
        <View style={styles.welcomeFeatureGrid}>
          {[
            ['wallet-outline', 'Organize', 'Wallets & budgets'],
            ['receipt-outline', 'Stay ahead', 'Bills & subscriptions'],
            ['flag-outline', 'Build', 'Savings goals'],
            ['sparkles-outline', 'Understand', 'Pengpeng insights'],
          ].map(([icon, title, caption]) => (
            <View key={title} style={styles.welcomeFeature}>
              <View style={styles.welcomeFeatureIcon}>
                <Ionicons name={icon} size={15} color={palette.cyan} />
              </View>
              <Text style={styles.welcomeFeatureTitle}>{title}</Text>
              <Text style={styles.welcomeFeatureCaption}>{caption}</Text>
            </View>
          ))}
        </View>
      </Spot>
    </View>
  );
}

function MockReady() {
  return (
    <View style={[styles.phonePage, styles.readyPage]}>
      <LinearGradient colors={gradients.ai} style={styles.readyAvatarHalo}>
        <PengpengAvatar size={88} />
      </LinearGradient>

      <Text style={styles.readyBrand}>PENGPENG</Text>
      <Text style={styles.readyTitle}>You’re ready to make Pengpeng yours.</Text>

      <Text style={styles.readyText}>
        Your balances, wallet budgets, bills, goals, reports, and spending
        patterns now work together as one personalized financial system.
      </Text>

      <View style={styles.readyFlow}>
        {[
          ['wallet-outline', 'Organize'],
          ['receipt-outline', 'Track'],
          ['flag-outline', 'Plan'],
          ['sparkles-outline', 'Understand'],
        ].map(([icon, label]) => (
          <View key={label} style={styles.readyFlowItem}>
            <View style={styles.readyFlowIcon}>
              <Ionicons name={icon} size={17} color={palette.cyan} />
            </View>
            <Text style={styles.readyFlowText}>{label}</Text>
          </View>
        ))}
      </View>

      <View style={styles.readyTip}>
        <Ionicons name="person-circle-outline" size={17} color={palette.primaryStrong} />
        <Text style={styles.readyTipText}>
          Keep your profile and financial preferences updated so Pengpeng’s
          insights stay relevant to you.
        </Text>
      </View>
    </View>
  );
}

function PageMock({ page, target }) {
  if (page === 'welcome') return <MockWelcome />;
  if (page === 'home') return <MockHome target={target} />;
  if (page === 'wallets') return <MockWallets target={target} />;
  if (page === 'addwallet') return <MockAddWallet target={target} />;
  if (page === 'walletDetail') return <MockWalletDetail target={target} />;
  if (page === 'bills') return <MockBills target={target} />;
  if (page === 'addPayable') return <MockAddPayable target={target} />;
  if (page === 'ai') return <MockAI target={target} />;
  if (page === 'profile') return <MockProfile target={target} />;
  return <MockReady />;
}

export default function AppTourScreen() {
  const navigation = useNavigation();
  const [index, setIndex] = useState(0);

  const step = useMemo(() => STEPS[index], [index]);
  const isFirst = index === 0;
  const isLast = index === STEPS.length - 1;

  const sectionProgress = useMemo(() => {
    const sameSection = STEPS.filter((s) => s.section === step.section);
    const position =
      sameSection.findIndex((s) => s === step) + 1;

    return {
      current: Math.max(1, position),
      total: sameSection.length,
    };
  }, [step]);

  const finish = async () => {
    try {
      await saveData('pengpeng_first_run_tour_seen_v1', true);
    } catch {}

    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    navigation.replace('ProfileOnboarding');
  };

  const next = () => {
    if (isLast) {
      finish();
      return;
    }

    setIndex((current) => current + 1);
  };

  const previous = () => {
    if (!isFirst) {
      setIndex((current) => current - 1);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.topBar}>
        <View style={styles.topBrandWrap}>
          <PengpengAvatar size={34} />
          <View>
            <Text style={styles.brand}>PENGPENG</Text>
            <Text style={styles.topTitle}>Interactive app guide</Text>
          </View>
        </View>

        {!isLast ? (
          <TouchableOpacity
            onPress={finish}
            activeOpacity={0.82}
            style={styles.skipButton}
          >
            <Text style={styles.skipText}>Skip tour</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 72 }} />
        )}
      </View>

      <View style={styles.topProgress}>
        <View
          style={[
            styles.topProgressFill,
            {
              width: `${((index + 1) / STEPS.length) * 100}%`,
            },
          ]}
        />
      </View>

      <ScrollView
        style={styles.scroller}
        contentContainerStyle={styles.scrollerContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.sectionLine}>
          <Text style={styles.sectionName}>{step.section}</Text>
          <Text style={styles.sectionCount}>
            {sectionProgress.current} of {sectionProgress.total}
          </Text>
        </View>

        <View style={styles.mockFrame}>
          <PageMock page={step.page} target={step.target} />
        </View>

        <View style={styles.explanation}>
          <View style={styles.explanationKicker}>
            <Ionicons name="information-circle-outline" size={16} color={palette.cyan} />
            <Text style={styles.explanationKickerText}>WHAT THIS DOES</Text>
          </View>

          <Text style={styles.explanationTitle}>{step.title}</Text>
          <Text style={styles.explanationBody}>{step.body}</Text>

          <View style={styles.detailBox}>
            <Ionicons name="bulb-outline" size={17} color={palette.primaryStrong} />
            <Text style={styles.detailText}>{step.detail}</Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.bottomBar}>
        <TouchableOpacity
          onPress={previous}
          disabled={isFirst}
          activeOpacity={0.82}
          style={[
            styles.backButton,
            isFirst && styles.backButtonDisabled,
          ]}
        >
          <Ionicons name="arrow-back" size={17} color={palette.textSoft} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.globalCount}>
          {index + 1} / {STEPS.length}
        </Text>

        <TouchableOpacity
          onPress={next}
          activeOpacity={0.9}
          style={styles.nextWrap}
        >
          <LinearGradient
            colors={gradients.primary}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.nextButton}
          >
            <Text style={styles.nextText}>
              {isLast ? 'Start using Pengpeng' : 'Next'}
            </Text>
            <Ionicons
              name={isLast ? 'sparkles' : 'arrow-forward'}
              size={17}
              color="#fff"
            />
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: palette.bg,
  },

  topBar: {
    minHeight: 64,
    paddingHorizontal: spacing.l,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  topBrandWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  brand: {
    color: palette.cyan,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.6,
  },

  topTitle: {
    color: palette.text,
    fontSize: 18,
    fontWeight: '900',
    marginTop: 2,
  },

  skipButton: {
    minHeight: 34,
    paddingHorizontal: 11,
    borderRadius: radius.pill,
    backgroundColor: palette.bgSoft,
    borderWidth: 1,
    borderColor: palette.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },

  skipText: {
    color: palette.textSoft,
    fontSize: 9,
    fontWeight: '800',
  },

  topProgress: {
    height: 3,
    marginHorizontal: spacing.l,
    borderRadius: 2,
    backgroundColor: palette.hairline,
    overflow: 'hidden',
  },

  topProgressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: palette.cyan,
  },

  scroller: {
    flex: 1,
  },

  scrollerContent: {
    paddingHorizontal: spacing.l,
    paddingTop: 13,
    paddingBottom: 22,
  },

  sectionLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 9,
  },

  sectionName: {
    color: palette.primaryStrong,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },

  sectionCount: {
    color: palette.muted,
    fontSize: 9,
    fontWeight: '800',
  },

  mockFrame: {
    minHeight: 410,
    borderRadius: 28,
    backgroundColor: palette.bgDeep,
    borderWidth: 1,
    borderColor: palette.hairline,
    overflow: 'hidden',
    ...shadow(7, 0.14),
  },

  phonePage: {
    flex: 1,
    minHeight: 410,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 58,
    backgroundColor: palette.bg,
  },

  pageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },

  mockOverline: {
    color: palette.primaryStrong,
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 0.9,
  },

  mockPageTitle: {
    color: palette.text,
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: -0.3,
    marginTop: 2,
  },

  mockSectionTitle: {
    color: palette.text,
    fontSize: 13,
    fontWeight: '900',
    marginTop: 2,
  },

  mockMeta: {
    color: palette.sub,
    fontSize: 7.5,
    lineHeight: 11,
  },

  mockRoundButton: {
    width: 31,
    height: 31,
    borderRadius: 16,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },

  spotlight: {
    borderWidth: 2,
    borderColor: palette.cyan,
    borderRadius: 14,
    backgroundColor: 'rgba(79,217,255,0.07)',
    shadowColor: palette.cyan,
    shadowOpacity: 0.42,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },

  focusBadge: {
    position: 'absolute',
    right: -2,
    top: -10,
    minHeight: 18,
    paddingHorizontal: 6,
    borderRadius: 9,
    backgroundColor: palette.cyan,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },

  focusBadgeText: {
    color: palette.bgDeep,
    fontSize: 6.5,
    fontWeight: '900',
    letterSpacing: 0.7,
  },

  spotNoClip: {
    borderRadius: 20,
  },

  roundSpot: {
    borderRadius: 21,
  },

  inlineSpot: {
    borderRadius: 11,
  },

  homeHero: {
    borderRadius: 21,
    padding: 14,
    overflow: 'hidden',
  },

  homeHeroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  mockHeroLabel: {
    color: '#C6DBF8',
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 0.7,
  },

  mockHeroAmount: {
    color: '#fff',
    fontSize: 25,
    fontWeight: '900',
    marginTop: 2,
  },

  heroAdd: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  homeChart: {
    height: 51,
    marginTop: 7,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },

  chartBar: {
    flex: 1,
    maxWidth: 20,
    marginRight: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },

  homeHeroFooter: {
    marginTop: 7,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.15)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  mockHeroSmallAmount: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
    marginTop: 2,
  },

  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 5,
  },

  linkText: {
    color: palette.cyan,
    fontSize: 7.5,
    fontWeight: '800',
    marginRight: 3,
  },

  mockSectionHeader: {
    marginTop: 11,
    marginBottom: 7,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },

  budgetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
  },

  budgetItem: {
    width: '24%',
    alignItems: 'center',
  },

  budgetCircle: {
    width: 35,
    height: 35,
    borderRadius: 18,
    backgroundColor: palette.cyanSoft,
    borderWidth: 1,
    borderColor: 'rgba(79,217,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  budgetName: {
    color: palette.textSoft,
    fontSize: 7,
    fontWeight: '800',
    marginTop: 4,
  },

  budgetPct: {
    color: palette.muted,
    fontSize: 6.5,
    marginTop: 1,
  },

  activityBox: {
    marginTop: 5,
    borderTopWidth: 1,
    borderTopColor: palette.hairline,
  },

  mockRow: {
    minHeight: 39,
    flexDirection: 'row',
    alignItems: 'center',
  },

  mockRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
  },

  mockRowIcon: {
    width: 27,
    height: 27,
    borderRadius: 14,
    backgroundColor: palette.cyanSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 7,
  },

  mockRowTitle: {
    flex: 1,
    color: palette.text,
    fontSize: 8.5,
    fontWeight: '800',
  },

  mockNegative: {
    color: palette.danger,
    fontSize: 8,
    fontWeight: '900',
  },

  mockPositive: {
    color: palette.success,
    fontSize: 8,
    fontWeight: '900',
  },

  pengpengFabSpot: {
    position: 'absolute',
    right: 13,
    bottom: 50,
    borderRadius: 20,
  },

  pengpengFab: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
  },

  pengpengFabText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '900',
    marginLeft: 5,
  },

  miniTabBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderTopColor: palette.hairline,
    paddingHorizontal: 6,
  },

  miniTab: {
    flex: 1,
    alignItems: 'center',
  },

  miniTabText: {
    color: palette.muted,
    fontSize: 6,
    marginTop: 2,
    fontWeight: '700',
  },

  miniTabTextActive: {
    color: palette.cyan,
  },

  walletHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  headerPlus: {
    width: 31,
    height: 31,
    borderRadius: 16,
    marginLeft: 6,
    backgroundColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  walletSummary: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: palette.hairline,
    paddingHorizontal: 5,
  },

  walletSummaryAmount: {
    color: palette.text,
    fontSize: 14,
    fontWeight: '900',
  },

  walletSummarySmall: {
    color: palette.textSoft,
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
  },

  featuredWallet: {
    borderRadius: 22,
    padding: 13,
  },

  featuredWalletName: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
  },

  featuredWalletLabel: {
    color: '#C6D7F1',
    fontSize: 7,
    marginTop: 12,
  },

  featuredWalletAmount: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
    marginTop: 1,
  },

  featuredProgress: {
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginTop: 9,
  },

  featuredProgressFill: {
    height: '100%',
    backgroundColor: '#79E6FF',
  },

  walletActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 11,
  },

  walletActionSpot: {
    width: '24%',
    alignItems: 'center',
    paddingVertical: 3,
  },

  walletActionIcon: {
    width: 29,
    height: 29,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.13)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  walletActionText: {
    color: '#E8F3FF',
    fontSize: 6.5,
    fontWeight: '800',
    marginTop: 3,
  },

  secondaryWallet: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
  },

  secondaryWalletAmount: {
    color: palette.text,
    fontSize: 9,
    fontWeight: '900',
  },

  addWalletPreview: {
    borderRadius: 22,
    padding: 14,
    marginTop: 11,
  },

  addWalletName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
    marginTop: 15,
  },

  addWalletAmount: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
    marginTop: 2,
  },

  addWalletMeta: {
    color: '#C8D8F4',
    fontSize: 7,
  },

  formLine: {
    minHeight: 48,
    paddingTop: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
  },

  formLabel: {
    color: palette.sub,
    fontSize: 7,
    fontWeight: '700',
  },

  formValue: {
    color: palette.text,
    fontSize: 10,
    fontWeight: '800',
    marginTop: 4,
  },

  formAmount: {
    color: palette.text,
    fontSize: 15,
    fontWeight: '900',
    marginTop: 3,
  },

  createWalletSpot: {
    marginTop: 16,
    borderRadius: 20,
  },

  fullPrimaryButton: {
    minHeight: 39,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },

  fullPrimaryButtonText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '900',
    marginLeft: 5,
  },

  detailHero: {
    borderRadius: 22,
    padding: 14,
    marginTop: 10,
  },

  detailHeroAmount: {
    color: '#fff',
    fontSize: 25,
    fontWeight: '900',
    marginTop: 3,
  },

  detailStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.16)',
  },

  detailStat: {
    color: '#D7E5FA',
    fontSize: 7,
    fontWeight: '700',
  },

  detailFabSpot: {
    position: 'absolute',
    right: 14,
    bottom: 17,
    borderRadius: 21,
  },

  detailFab: {
    width: 41,
    height: 41,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },

  demoTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 9,
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
  },

  demoTabActive: {
    paddingBottom: 7,
    borderBottomWidth: 2,
    borderBottomColor: palette.cyan,
    marginRight: 14,
  },

  demoTabActiveText: {
    color: palette.text,
    fontSize: 8,
    fontWeight: '900',
  },

  demoTabText: {
    color: palette.sub,
    fontSize: 8,
    fontWeight: '700',
    paddingBottom: 7,
  },

  billSummary: {
    borderRadius: 18,
    padding: 12,
  },

  billSummaryAmount: {
    color: '#fff',
    fontSize: 21,
    fontWeight: '900',
    marginTop: 2,
  },

  billSummaryMeta: {
    color: '#BDD0EB',
    fontSize: 7,
    marginTop: 2,
  },

  filterMockRow: {
    flexDirection: 'row',
    marginTop: 10,
    marginBottom: 2,
  },

  filterMock: {
    minHeight: 25,
    paddingHorizontal: 8,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },

  filterMockActive: {
    backgroundColor: palette.primarySoft,
  },

  filterMockText: {
    color: palette.sub,
    fontSize: 6.5,
    fontWeight: '800',
  },

  filterMockTextActive: {
    color: palette.cyan,
  },

  billRows: {
    marginTop: 5,
    borderTopWidth: 1,
    borderTopColor: palette.hairline,
  },

  billRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
  },

  billRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
  },

  billIcon: {
    width: 31,
    height: 31,
    borderRadius: 16,
    backgroundColor: palette.cyanSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 7,
  },

  billRight: {
    alignItems: 'flex-end',
    marginLeft: 7,
  },

  billAmount: {
    color: palette.text,
    fontSize: 9,
    fontWeight: '900',
  },

  paySpot: {
    borderRadius: 12,
    marginTop: 4,
  },

  payMockButton: {
    minWidth: 39,
    minHeight: 22,
    borderRadius: 11,
    backgroundColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  payMockText: {
    color: '#fff',
    fontSize: 6.5,
    fontWeight: '900',
  },

  subscriptionControlMock: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
  },

  subscriptionControlText: {
    color: palette.cyan,
    fontSize: 6,
    fontWeight: '800',
  },

  hideMock: {
    position: 'absolute',
    right: 13,
    bottom: 54,
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: 15,
    backgroundColor: palette.danger,
    flexDirection: 'row',
    alignItems: 'center',
  },

  hideMockText: {
    color: '#fff',
    fontSize: 7,
    fontWeight: '900',
    marginLeft: 5,
  },

  typeSwitchMock: {
    flexDirection: 'row',
    marginTop: 13,
    marginBottom: 8,
  },

  typeSwitchActive: {
    flex: 1,
    minHeight: 36,
    borderRadius: 14,
    backgroundColor: palette.primarySoft,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 5,
  },

  typeSwitchItem: {
    flex: 1,
    minHeight: 36,
    borderRadius: 14,
    backgroundColor: palette.bgSoft,
    borderWidth: 1,
    borderColor: palette.hairline,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },

  typeSwitchActiveText: {
    color: palette.text,
    fontSize: 8,
    fontWeight: '900',
    marginLeft: 5,
  },

  typeSwitchText: {
    color: palette.sub,
    fontSize: 8,
    fontWeight: '800',
    marginLeft: 5,
  },

  aiStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },

  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.cyan,
    marginRight: 5,
  },

  aiSnapshot: {
    borderRadius: 21,
    padding: 13,
  },

  aiAmount: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
    marginTop: 2,
  },

  aiStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.16)',
  },

  aiStatText: {
    color: '#D5E3F7',
    fontSize: 7,
    fontWeight: '700',
  },

  moneyNoteMock: {
    minHeight: 49,
    marginTop: 8,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
  },

  noteIconMock: {
    width: 29,
    height: 29,
    borderRadius: 15,
    backgroundColor: palette.cyanSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 7,
  },

  noteTextMock: {
    color: palette.textSoft,
    fontSize: 7.5,
    lineHeight: 11,
    marginTop: 2,
  },

  askMock: {
    minHeight: 54,
    borderRadius: 17,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    marginTop: 7,
    padding: 10,
  },

  askPlaceholder: {
    color: palette.muted,
    fontSize: 7.5,
  },

  askSend: {
    position: 'absolute',
    right: 7,
    bottom: 7,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  quickQuestionRow: {
    flexDirection: 'row',
    marginTop: 8,
    paddingVertical: 3,
  },

  quickQuestion: {
    width: '49%',
    minHeight: 39,
    borderRadius: 13,
    backgroundColor: palette.bgSoft,
    borderWidth: 1,
    borderColor: palette.hairline,
    padding: 7,
    marginRight: '2%',
  },

  quickQuestionText: {
    color: palette.textSoft,
    fontSize: 6.7,
    lineHeight: 9,
    fontWeight: '700',
  },

  aiAnswerMock: {
    marginTop: 8,
    paddingTop: 7,
    borderTopWidth: 1,
    borderTopColor: palette.hairline,
  },

  aiAnswerHeaderMock: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  dataBadge: {
    minHeight: 18,
    paddingHorizontal: 6,
    borderRadius: 9,
    backgroundColor: palette.cyanSoft,
    justifyContent: 'center',
  },

  dataBadgeText: {
    color: palette.cyan,
    fontSize: 6,
    fontWeight: '900',
  },

  aiAnswerTitleMock: {
    color: palette.text,
    fontSize: 10,
    fontWeight: '900',
    marginTop: 2,
  },

  aiAnswerBodyMock: {
    color: palette.textSoft,
    fontSize: 7.2,
    lineHeight: 11,
    marginTop: 4,
  },

  profileHero: {
    borderRadius: 22,
    padding: 13,
  },

  profileMockTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  avatarMock: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.17)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },

  avatarMockText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
  },

  profileMockName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
    marginTop: 2,
  },

  profileButtonRow: {
    flexDirection: 'row',
    marginTop: 11,
  },

  profileButtonSpot: {
    width: '49%',
    borderRadius: 14,
    marginRight: '2%',
  },

  profileButton: {
    minHeight: 31,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.15)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },

  profileButtonText: {
    color: '#fff',
    fontSize: 7,
    fontWeight: '900',
    marginLeft: 5,
  },

  newGoalMock: {
    minHeight: 25,
    paddingHorizontal: 8,
    borderRadius: 13,
    backgroundColor: palette.cyan,
    flexDirection: 'row',
    alignItems: 'center',
  },

  newGoalMockText: {
    color: palette.bgDeep,
    fontSize: 6.5,
    fontWeight: '900',
    marginLeft: 2,
  },

  goalMock: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: palette.hairline,
    paddingVertical: 10,
  },

  goalMockTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  goalMockTitle: {
    color: palette.text,
    fontSize: 11,
    fontWeight: '900',
  },

  goalPct: {
    color: palette.cyan,
    fontSize: 10,
    fontWeight: '900',
  },

  goalTrack: {
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: palette.hairline,
    marginTop: 8,
  },

  goalFill: {
    height: '100%',
    backgroundColor: palette.cyan,
  },

  goalMonthRow: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 5,
  },

  goalMonthText: {
    color: palette.textSoft,
    fontSize: 7.5,
    fontWeight: '700',
  },

  goalCheck: {
    width: 22,
    height: 22,
    borderRadius: 7,
    backgroundColor: palette.success,
    alignItems: 'center',
    justifyContent: 'center',
  },

  reportMock: {
    minHeight: 54,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: palette.hairline,
    paddingTop: 8,
  },

  reportIconMock: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: palette.cyanSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },

  reportButtonMock: {
    minHeight: 24,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  reportButtonText: {
    color: '#fff',
    fontSize: 6.5,
    fontWeight: '900',
  },

  welcomePage: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 24,
    overflow: 'hidden',
  },

  welcomeGlow: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    top: -110,
    right: -70,
    backgroundColor: 'rgba(59,130,246,0.16)',
  },

  welcomeAvatarWrap: {
    marginTop: 6,
    marginBottom: 12,
  },

  welcomeAvatarHalo: {
    width: 122,
    height: 122,
    borderRadius: 61,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(79,217,255,0.28)',
  },

  welcomeOverline: {
    color: palette.cyan,
    fontSize: 7.5,
    fontWeight: '900',
    letterSpacing: 1.1,
    textAlign: 'center',
  },

  welcomeTitle: {
    color: palette.text,
    fontSize: 25,
    fontWeight: '900',
    letterSpacing: -0.7,
    marginTop: 4,
    textAlign: 'center',
  },

  welcomeText: {
    color: palette.textSoft,
    fontSize: 9.5,
    lineHeight: 14.5,
    textAlign: 'center',
    maxWidth: 270,
    marginTop: 7,
  },

  welcomeFeatureSpot: {
    width: '100%',
    borderRadius: 20,
    marginTop: 18,
  },

  welcomeFeatureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 8,
    padding: 10,
  },

  welcomeFeature: {
    width: '48.5%',
    minHeight: 67,
    borderRadius: 15,
    padding: 9,
    backgroundColor: palette.bgSoft,
    borderWidth: 1,
    borderColor: palette.hairline,
  },

  welcomeFeatureIcon: {
    width: 27,
    height: 27,
    borderRadius: 14,
    backgroundColor: palette.cyanSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 5,
  },

  welcomeFeatureTitle: {
    color: palette.text,
    fontSize: 8.5,
    fontWeight: '900',
  },

  welcomeFeatureCaption: {
    color: palette.sub,
    fontSize: 6.8,
    marginTop: 1,
  },

  readyPage: {
    paddingBottom: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

  readyOrb: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow(9, 0.22),
  },

  readyTitle: {
    color: palette.text,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '900',
    textAlign: 'center',
    maxWidth: 280,
    marginTop: 17,
  },

  readyText: {
    color: palette.sub,
    fontSize: 9,
    lineHeight: 14,
    textAlign: 'center',
    maxWidth: 300,
    marginTop: 7,
  },

  readyFlow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 23,
  },

  readyFlowItem: {
    width: '24%',
    alignItems: 'center',
  },

  readyFlowIcon: {
    width: 37,
    height: 37,
    borderRadius: 19,
    backgroundColor: palette.cyanSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  readyFlowText: {
    color: palette.textSoft,
    fontSize: 7,
    fontWeight: '800',
    marginTop: 5,
  },

  explanation: {
    marginTop: 15,
  },

  explanationKicker: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  explanationKickerText: {
    color: palette.cyan,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.1,
    marginLeft: 5,
  },

  explanationTitle: {
    color: palette.text,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '900',
    letterSpacing: -0.35,
    marginTop: 7,
  },

  explanationBody: {
    color: palette.textSoft,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 6,
  },

  detailBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 10,
    padding: 11,
    borderRadius: 16,
    backgroundColor: palette.bgSoft,
    borderWidth: 1,
    borderColor: palette.hairline,
  },

  detailText: {
    flex: 1,
    color: palette.sub,
    fontSize: 9.5,
    lineHeight: 15,
    marginLeft: 8,
  },

  bottomBar: {
    minHeight: 76,
    paddingHorizontal: spacing.l,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 17 : 11,
    backgroundColor: 'rgba(6,16,31,0.98)',
    borderTopWidth: 1,
    borderTopColor: palette.hairline,
    flexDirection: 'row',
    alignItems: 'center',
  },

  backButton: {
    minWidth: 72,
    minHeight: 45,
    flexDirection: 'row',
    alignItems: 'center',
  },

  backButtonDisabled: {
    opacity: 0,
  },

  backText: {
    color: palette.textSoft,
    fontSize: 10,
    fontWeight: '800',
    marginLeft: 6,
  },

  globalCount: {
    color: palette.muted,
    fontSize: 9,
    fontWeight: '800',
    marginHorizontal: 10,
  },

  nextWrap: {
    flex: 1,
    maxWidth: 170,
    marginLeft: 'auto',
    borderRadius: radius.pill,
    overflow: 'hidden',
    ...shadow(7, 0.18),
  },

  nextButton: {
    minHeight: 47,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },

  nextText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
    marginRight: 7,
  },
});
