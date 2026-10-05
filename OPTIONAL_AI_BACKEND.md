# Optional Pengpeng AI Backend

Pengpeng works without a remote AI service by using local financial retrieval, calculations, and spending-pattern analysis. The serverless backend in this repository is optional and is only needed if you want open-ended generative answers.

## Why use a backend?

Provider API keys must never be shipped inside an Expo/React Native client. The optional Netlify Function keeps the provider key server-side and accepts only a public proxy URL from the mobile app.

## Server environment variables

Configure these in the Netlify project environment:

```text
COHERE_API_KEY=<your private provider key>
COHERE_MODEL=command-a-03-2025
```

Do **not** put `COHERE_API_KEY` in `app.json`, source files, or an `EXPO_PUBLIC_*` variable.

## Mobile app configuration

Copy `.env.example` to `.env` and set:

```env
EXPO_PUBLIC_AI_PROXY_URL=https://YOUR-AI-BACKEND.netlify.app/.netlify/functions/financial-ai
```

Restart Expo after changing `.env`:

```bash
npx expo start -c
```

When no proxy URL is configured, Pengpeng remains in **Local Insights** mode.
