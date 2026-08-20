const DEFAULT_MODEL = 'gpt-5.4';

function isConfigured() {
  return Boolean(process.env.CODEX_BASE_URL && process.env.CODEX_API_KEY);
}

async function getCodexResponse(prompt) {
  if (!isConfigured()) {
    throw new Error('Codex provider is not configured');
  }

  const baseUrl = process.env.CODEX_BASE_URL.replace(/\/$/, '');
  const model = process.env.CODEX_MODEL || DEFAULT_MODEL;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.CODEX_TIMEOUT_MS) || 60000);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.CODEX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Codex API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('Codex API returned an empty response');
    }

    return content;
  } finally {
    clearTimeout(timeout);
  }
}

export { getCodexResponse, isConfigured };
