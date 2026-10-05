# Pengpeng — The Smart AI Expense Tracker

Pengpeng is a local-first personal finance app built with React Native and Expo. It combines cash and wallet tracking, category budgets, bills and subscriptions, payday income, Auto Split, savings goals, PDF reports, notifications, and personalized financial insights in one mobile experience.

The app is designed around a friendly penguin assistant named **Pengpeng**. The assistant uses the financial information saved in the app to provide local summaries and spending-pattern insights. An optional secure server-side AI proxy is included for future open-ended generative responses; it is not required for the core app.

## Highlights

- **Branded first-run experience** — Pengpeng splash → guided App Tour → financial Profile Onboarding → Home
- **Personalized dashboard** — Total Balance, monthly spending, Today spending, wallet budget progress, calendar, and recent transactions
- **Wallet management** — custom wallets, deposits, withdrawals, transfers, monthly caps, transaction history, and wallet-level expenses
- **Auto Split** — distribute payday income across wallets using percentage allocations
- **Bills & subscriptions** — due dates, payment source, payment history, Autopay/Pause controls, filters, and reminders
- **Savings goals** — target amounts, contribution plans, progress tracking, and dedicated goal balances
- **Pengpeng AI / Local Insights** — financial snapshot, quick questions, transaction-aware retrieval, RAG-style context, and spending-pattern analysis
- **Reports** — monthly financial report generation with PDF export and sharing
- **Notifications** — bill, payday, and budget-related reminders
- **Local-first storage** — financial data is persisted on-device with AsyncStorage

## Current AI behavior

Pengpeng currently works in **Local Insights** mode by default. It can retrieve and analyze saved app data including:

- balances and wallets
- wallet expense history
- monthly caps and budgets
- bills, subscriptions, and payment history
- recurring/payday income
- Auto Split configuration
- savings goals and contribution schedules
- transaction/ledger history
- user-stated spending preferences
- derived spending patterns such as category totals and budget risk

The quick-question buttons are examples, not a separate data source. Local responses are calculated from the user's saved financial context.

For unrestricted generative answers, the repository also contains an **optional** secure backend integration. See [`OPTIONAL_AI_BACKEND.md`](./OPTIONAL_AI_BACKEND.md).

## Tech stack

- React Native
- Expo SDK 57
- JavaScript
- React Navigation
- AsyncStorage
- React Native SVG
- React Native Calendars
- Expo Notifications
- Expo Print
- Expo Sharing
- Expo Image Picker
- Local retrieval / RAG-style financial context
- Optional Cohere integration through a server-side proxy

## First-launch flow

```text
Fresh install
    ↓
Pengpeng splash
    ↓
Tap to continue
    ↓
App Tour
    ↓
Profile Onboarding
    ↓
Home
```

After onboarding is complete:

```text
Reopen app
    ↓
Pengpeng splash
    ↓
Tap to continue
    ↓
Home
```

The App Tour can still be reopened manually from Profile.

## Project structure

```text
App.js                         Navigation and first-run routing
assets/branding/               Pengpeng splash, avatar, and app icon
src/components/                Reusable UI components
src/screens/                   Main application screens
src/theme/design.js            Shared visual tokens and navigation theme
src/utils/                     Storage, budgets, goals, bills, income, reports, RAG, and analytics
src/services/aiClient.js       Optional secure remote-AI client
backend/netlify/               Optional serverless AI proxy
docs/screenshots/              Final portfolio screenshots
```

## Run locally

### Requirements

- Node.js 22+ recommended
- npm
- Expo Go or an Android/iOS development environment

### Install

```bash
npm install
```

### Start

```bash
npx expo start -c
```

Scan the QR code with Expo Go or launch a simulator/emulator.

## Useful commands

```bash
npm start
npm run android
npm run ios
npm run web
npm run doctor
npm run export:android
```

## Data & privacy

The core app stores financial data locally with AsyncStorage. No provider API key is embedded in the client. If the optional remote AI integration is enabled, only the public backend URL belongs in the Expo environment; the provider key remains on the server.

## Portfolio screenshots

A screenshot checklist is included in [`docs/screenshots/README.md`](./docs/screenshots/README.md). Use actual device screenshots from the finished app for the GitHub repository and portfolio case study.

## Status

Portfolio-ready mobile application. Core flows have been manually tested in Expo Go, including first-run navigation, wallet transactions, bill/subscription actions, Pengpeng input, Today spending updates, profile/goals, and local data persistence.
