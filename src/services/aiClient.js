// Secure AI client for the mobile app.
// The mobile bundle contains only a public proxy URL. Provider API keys stay server-side.

const getEndpoint = () => String(process.env.EXPO_PUBLIC_AI_PROXY_URL || '').trim();

export function isRemoteAIConfigured() {
  return Boolean(getEndpoint());
}

export async function requestFinancialAI({ prompt, temperature = 0.2 }) {
  const endpoint = getEndpoint();
  if (!endpoint) {
    const err = new Error('AI proxy is not configured.');
    err.code = 'AI_PROXY_NOT_CONFIGURED';
    throw err;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, temperature }),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || `AI request failed (${response.status}).`);
    }

    const text = String(data?.text || '').trim();
    if (!text) throw new Error('AI returned an empty response.');
    return text;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Pengpeng AI request timed out.');
      timeoutError.code = 'AI_TIMEOUT';
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
