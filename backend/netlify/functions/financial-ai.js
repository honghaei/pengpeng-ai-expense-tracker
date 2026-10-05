const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed.' }) };
  }

  const apiKey = process.env.COHERE_API_KEY;
  const model = process.env.COHERE_MODEL || 'command-a-03-2025';

  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server AI key is not configured.' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const prompt = String(body?.prompt || '').trim();
    const temperature = Number.isFinite(Number(body?.temperature))
      ? Math.max(0, Math.min(1, Number(body.temperature)))
      : 0.2;

    if (!prompt) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Prompt is required.' }) };
    }

    const response = await fetch('https://api.cohere.com/v2/chat', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Client-Name': 'smart-expense-tracker',
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          {
            role: 'system',
            content:
              'You are Pengpeng, the AI assistant inside the Pengpeng expense tracker. The profile name in the supplied data belongs to the user and is never your name. Use the supplied app data as the factual source of truth. You are not limited to canned questions: answer any reasonable question. For personal-finance questions, reason across the supplied transactions, user preferences, inferred spending patterns, balances, wallets, budgets, bills, subscriptions, income/paydays, Auto Split, savings goals, ledger history, and recent conversation. Personalize recommendations using recorded patterns, but distinguish explicit user preferences from inferences. Do not invent balances, transactions, merchants, bills, goals, income, due dates, preferences, or trends. You may answer general financial education questions, but clearly distinguish general guidance from facts about this user. Never claim permanent training on the user. Avoid markdown tables and keep responses practical.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.message || data?.error?.message || `Cohere request failed (${response.status}).`;
      return { statusCode: response.status, headers, body: JSON.stringify({ error: message }) };
    }

    const text = data?.message?.content
      ?.filter((part) => part?.type === 'text')
      ?.map((part) => part.text)
      ?.join('\n')
      ?.trim();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ text: text || 'No response.' }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error?.message || 'Unexpected server error.' }),
    };
  }
};
