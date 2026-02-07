// Background service worker for Zen extension

const API_CACHE = new Map();
const CACHE_DURATION = 5 * 60 * 1000;
let rateLimitUntil = 0;

const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: { vision: 'gpt-4o-mini', text: 'gpt-4o-mini' },
    supportsVision: true,
    supportsModeration: true
  },
  claude: {
    name: 'Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    models: { vision: 'claude-sonnet-4-20250514', text: 'claude-haiku-4-20250514' },
    supportsVision: true,
    supportsModeration: false
  },
  kimi: {
    name: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: { vision: 'moonshot-v1-8k-vision-preview', text: 'moonshot-v1-8k' },
    supportsVision: true,
    supportsModeration: false
  },
  custom: {
    name: 'Custom (OpenAI-compatible)',
    baseUrl: '',
    models: { vision: '', text: '' },
    supportsVision: true,
    supportsModeration: false
  }
};

chrome.runtime.onInstalled.addListener(() => {});
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.set({ enabled: false });
});

const getProviderConfig = async (providerType) => {
  const result = await chrome.storage.local.get(['apiKeys', 'customProviderConfig', 'imageProvider', 'cryptoProvider']);
  const providerId = providerType === 'image' ? (result.imageProvider || 'openai') : (result.cryptoProvider || 'openai');
  const apiKeys = result.apiKeys || {};
  const customConfig = result.customProviderConfig || { baseUrl: '', visionModel: '', textModel: '' };
  let provider = { ...PROVIDERS[providerId] };
  if (providerId === 'custom') {
    provider.baseUrl = customConfig.baseUrl;
    provider.models = { vision: customConfig.visionModel, text: customConfig.textModel };
  }
  return { providerId, provider, apiKey: apiKeys[providerId] || '', customConfig };
};

const getApiKey = async () => {
  const result = await chrome.storage.local.get(['apiKey', 'apiKeys']);
  return result.apiKeys?.openai || result.apiKey;
};

const callOpenAIStyleAPI = async (baseUrl, apiKey, model, messages, maxTokens = 10) => {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.1 })
  });
  if (!response.ok) throw new Error(`API error ${response.status}`);
  const data = await response.json();
  return data.choices[0]?.message?.content || '';
};

const callClaudeAPI = async (apiKey, model, messages, maxTokens = 10) => {
  const systemMessage = messages.find(m => m.role === 'system');
  const userMessages = messages.filter(m => m.role !== 'system');
  const claudeMessages = userMessages.map(msg => {
    if (typeof msg.content === 'string') return { role: msg.role, content: msg.content };
    const content = msg.content.map(item => {
      if (item.type === 'text') return { type: 'text', text: item.text };
      if (item.type === 'image_url') {
        const url = item.image_url.url;
        if (url.startsWith('data:')) {
          const matches = url.match(/^data:(.+);base64,(.+)$/);
          if (matches) return { type: 'image', source: { type: 'base64', media_type: matches[1], data: matches[2] } };
        }
        return { type: 'image', source: { type: 'url', url } };
      }
      return item;
    });
    return { role: msg.role, content };
  });
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system: systemMessage?.content || '', messages: claudeMessages })
  });
  if (!response.ok) throw new Error(`Claude API error ${response.status}`);
  const data = await response.json();
  return data.content[0]?.text || '';
};

const callProviderAPI = async (providerId, provider, apiKey, messages, maxTokens = 10, useVisionModel = false) => {
  const model = useVisionModel ? provider.models.vision : provider.models.text;
  return providerId === 'claude'
    ? await callClaudeAPI(apiKey, model, messages, maxTokens)
    : await callOpenAIStyleAPI(provider.baseUrl, apiKey, model, messages, maxTokens);
};

const checkImageModeration = async (imageUrl, imageBase64, postText, useFreeModeration = false, sexualThreshold = 0.3) => {
  const cacheKey = `img_${imageUrl || imageBase64?.substring(0, 50)}`;
  const cached = API_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) return cached.result;

  const { providerId, provider, apiKey } = await getProviderConfig('image');
  const effectiveApiKey = apiKey || await getApiKey();
  if (!effectiveApiKey) throw new Error('API key not configured');

  try {
    if (useFreeModeration && providerId === 'openai') {
      if (Date.now() < rateLimitUntil) return false;
      const moderationInput = imageBase64 ? `data:image/jpeg;base64,${imageBase64}` : imageUrl || postText;

      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, Math.min(1000 * Math.pow(2, attempt - 1), 10000)));
        try {
          const res = await fetch('https://api.openai.com/v1/moderations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${effectiveApiKey}` },
            body: JSON.stringify({ input: moderationInput })
          });
          if (res.ok) {
            const data = await res.json();
            const scores = data.results[0]?.category_scores || {};
            const categories = data.results[0]?.categories || {};
            const flagged = data.results[0]?.flagged || false;
            const result = (flagged && (categories.sexual || categories.sexual_minors)) || scores.sexual > sexualThreshold || scores.harassment > 0.5;
            API_CACHE.set(cacheKey, { result, timestamp: Date.now() });
            rateLimitUntil = 0;
            return result;
          } else if (res.status === 429) {
            rateLimitUntil = Date.now() + 60000;
            if (attempt === 2) return false;
          } else break;
        } catch (e) { if (attempt === 2) break; }
      }
      return false;
    }

    const imageContent = imageBase64
      ? { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
      : { type: 'image_url', image_url: { url: imageUrl } };

    const messages = [
      { role: 'system', content: `You detect "thirst trap" content. FILTER (yes): revealing selfies, body-focused photos, suggestive poses. ALLOW (no): normal photos, memes, art. Reply only "yes" or "no".` },
      { role: 'user', content: [{ type: 'text', text: 'Is this a thirst trap?' }, imageContent] }
    ];

    const aiResponse = await callProviderAPI(providerId, provider, effectiveApiKey, messages, 10, true);
    const result = aiResponse.toLowerCase().includes('yes');
    API_CACHE.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  } catch (error) {
    console.error('[Zen] Image check error:', error.message);
    return false;
  }
};

const checkCryptoContent = async (text) => {
  if (!text?.trim()) return false;
  const cacheKey = `text_${text.substring(0, 100)}`;
  const cached = API_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) return cached.result;

  const { providerId, provider, apiKey } = await getProviderConfig('crypto');
  const effectiveApiKey = apiKey || await getApiKey();
  if (!effectiveApiKey) throw new Error('API key not configured');

  try {
    const messages = [
      { role: 'system', content: 'Is this about crypto/blockchain/NFT/trading? Reply only "yes" or "no".' },
      { role: 'user', content: text }
    ];
    const response = await callProviderAPI(providerId, provider, effectiveApiKey, messages, 10, false);
    const result = response.toLowerCase().includes('yes');
    API_CACHE.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  } catch (error) {
    console.error('[Zen] Crypto check error:', error.message);
    return false;
  }
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const safeSend = (data) => { try { sendResponse(data); } catch {} };

  if (request.action === 'checkImage') {
    chrome.storage.local.get(['sexualThreshold'], (r) => {
      checkImageModeration(request.imageUrl, request.imageBase64, request.postText, request.useFreeModeration, r.sexualThreshold ?? 0.3)
        .then(result => safeSend({ success: true, result }))
        .catch(error => safeSend({ success: false, error: error.message }));
    });
    return true;
  }

  if (request.action === 'checkCrypto') {
    checkCryptoContent(request.text)
      .then(result => safeSend({ success: true, result }))
      .catch(error => safeSend({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'testProvider') {
    (async () => {
      try {
        const { providerId, apiKey, customConfig } = request;
        let provider = { ...PROVIDERS[providerId] };
        if (providerId === 'custom') {
          provider.baseUrl = customConfig?.baseUrl || '';
          provider.models = { vision: customConfig?.visionModel || '', text: customConfig?.textModel || '' };
        }
        if (!apiKey) throw new Error('API key required');
        if (providerId === 'custom' && !provider.baseUrl) throw new Error('Base URL required');
        await callProviderAPI(providerId, provider, apiKey, [{ role: 'user', content: 'test' }], 10, false);
        safeSend({ success: true });
      } catch (error) {
        safeSend({ success: false, error: error.message });
      }
    })();
    return true;
  }

  return false;
});
