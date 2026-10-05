# Optional Pengpeng Generative AI Backend

The current Pengpeng portfolio build works without a remote AI provider. It uses local financial retrieval, calculations, and spending-pattern analysis.

A server-side AI integration can be added later if unrestricted, open-ended generative responses are desired.

## Intended architecture

```text
Pengpeng mobile app
        ↓
Current financial context
        ↓
Secure backend endpoint
        ↓
AI provider
        ↓
Personalized response
```

## Security requirement

A provider API key must **never** be embedded inside the Expo / React Native application.

The mobile app should only know a public backend URL, for example:

```env
EXPO_PUBLIC_AI_PROXY_URL=https://YOUR-BACKEND.example.com/financial-ai
```

The private provider key belongs only in the backend environment.

## Current repository status

The portfolio repository does not need a deployed AI backend for its core functionality. Local Insights remains the supported default mode.
