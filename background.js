// Background service worker for Zen extension

console.log('[Zen] Background service worker started');

const API_CACHE = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Rate limit tracking
let rateLimitUntil = 0; // Timestamp when rate limit expires
const RATE_LIMIT_COOLDOWN = 60 * 1000; // Wait 1 minute after rate limit

// Provider configurations
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

// Keep service worker alive by handling any runtime events
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Zen] Extension installed/updated');
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[Zen] Extension startup - resetting to disabled');
  chrome.storage.local.set({ enabled: false });
});

// Get provider configuration from storage
const getProviderConfig = async (providerType) => {
  const result = await chrome.storage.local.get([
    'apiKeys',
    'customProviderConfig',
    'imageProvider',
    'cryptoProvider'
  ]);

  const providerId = providerType === 'image' ? (result.imageProvider || 'openai') : (result.cryptoProvider || 'openai');
  const apiKeys = result.apiKeys || {};
  const customConfig = result.customProviderConfig || { baseUrl: '', visionModel: '', textModel: '' };

  // Get provider config
  let provider = { ...PROVIDERS[providerId] };

  // For custom provider, use user-configured values
  if (providerId === 'custom') {
    provider.baseUrl = customConfig.baseUrl;
    provider.models = {
      vision: customConfig.visionModel,
      text: customConfig.textModel
    };
  }

  return {
    providerId,
    provider,
    apiKey: apiKeys[providerId] || '',
    customConfig
  };
};

// Legacy: Get API key from storage (for backwards compatibility)
const getApiKey = async () => {
  const result = await chrome.storage.local.get(['apiKey', 'apiKeys']);
  // Check new format first, then fall back to legacy
  if (result.apiKeys?.openai) {
    return result.apiKeys.openai;
  }
  return result.apiKey;
};

// OpenAI-style API call (works for OpenAI, Kimi, and custom OpenAI-compatible)
const callOpenAIStyleAPI = async (baseUrl, apiKey, model, messages, maxTokens = 10) => {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.1
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || '';
};

// Claude API call
const callClaudeAPI = async (apiKey, model, messages, maxTokens = 10) => {
  // Convert OpenAI-style messages to Claude format
  const systemMessage = messages.find(m => m.role === 'system');
  const userMessages = messages.filter(m => m.role !== 'system');

  // Transform message content for Claude
  const claudeMessages = userMessages.map(msg => {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: msg.content };
    }
    // Handle vision messages with image content
    const content = msg.content.map(item => {
      if (item.type === 'text') {
        return { type: 'text', text: item.text };
      }
      if (item.type === 'image_url') {
        const url = item.image_url.url;
        // Check if it's base64
        if (url.startsWith('data:')) {
          const matches = url.match(/^data:(.+);base64,(.+)$/);
          if (matches) {
            return {
              type: 'image',
              source: {
                type: 'base64',
                media_type: matches[1],
                data: matches[2]
              }
            };
          }
        }
        // URL-based image
        return {
          type: 'image',
          source: {
            type: 'url',
            url: url
          }
        };
      }
      return item;
    });
    return { role: msg.role, content };
  });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemMessage?.content || '',
      messages: claudeMessages
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.content[0]?.text || '';
};

// Generic provider API call dispatcher
const callProviderAPI = async (providerId, provider, apiKey, messages, maxTokens = 10, useVisionModel = false) => {
  const model = useVisionModel ? provider.models.vision : provider.models.text;

  if (providerId === 'claude') {
    return await callClaudeAPI(apiKey, model, messages, maxTokens);
  } else {
    // OpenAI, Kimi, and custom use OpenAI-compatible API
    return await callOpenAIStyleAPI(provider.baseUrl, apiKey, model, messages, maxTokens);
  }
};

// Check if image is inappropriate using configured provider
const checkImageModeration = async (imageUrl, imageBase64, postText, useFreeModeration = false, sexualThreshold = 0.3) => {
  console.log('[Zen] checkImageModeration called', {
    hasImageUrl: !!imageUrl,
    hasBase64: !!imageBase64,
    hasPostText: !!postText,
    useFreeModeration,
    sexualThreshold
  });

  const cacheKey = `img_${imageUrl || imageBase64?.substring(0, 50)}`;
  const cached = API_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log('[Zen] Image moderation cache HIT', { cacheKey, result: cached.result });
    return cached.result;
  }
  console.log('[Zen] Image moderation cache MISS', { cacheKey });

  // Get provider config
  const { providerId, provider, apiKey } = await getProviderConfig('image');

  // Fallback to legacy API key if needed
  const effectiveApiKey = apiKey || await getApiKey();

  if (!effectiveApiKey) {
    console.error('[Zen] API key not configured for image moderation');
    throw new Error('API key not configured');
  }

  console.log('[Zen] Using provider for image moderation:', providerId);

  try {
    // Option 1: Use FREE OpenAI Moderation API (only available for OpenAI)
    if (useFreeModeration && providerId === 'openai') {
      console.log('[Zen] Using FREE OpenAI Moderation API for image');

      // Check if we're in rate limit cooldown
      if (Date.now() < rateLimitUntil) {
        const waitTime = Math.ceil((rateLimitUntil - Date.now()) / 1000);
        console.log(`[Zen] Rate limit cooldown active, skipping moderation (wait ${waitTime}s)`);
        return false;
      }

      const moderationInput = imageBase64
        ? `data:image/jpeg;base64,${imageBase64}`
        : imageUrl || postText;

      console.log('[Zen] Sending request to Moderation API', {
        inputType: imageBase64 ? 'base64' : imageUrl ? 'url' : 'text',
        inputLength: moderationInput.length
      });

      // Retry with exponential backoff for rate limits
      let lastError = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
          const backoffDelay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          console.log(`[Zen] Retry attempt ${attempt + 1} after ${backoffDelay}ms`);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
        }

        try {
          const moderationResponse = await fetch('https://api.openai.com/v1/moderations', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${effectiveApiKey}`
            },
            body: JSON.stringify({
              input: moderationInput
            })
          });

          if (moderationResponse.ok) {
            const moderationData = await moderationResponse.json();
            const flagged = moderationData.results[0]?.flagged || false;
            const categories = moderationData.results[0]?.categories || {};
            const categoryScores = moderationData.results[0]?.category_scores || {};

            console.log('[Zen] Moderation API response (FULL)', {
              flagged,
              categories,
              categoryScores
            });

            const sexualScore = categoryScores.sexual || 0;
            const harassmentScore = categoryScores.harassment || 0;

            const result = (flagged && (categories.sexual || categories.sexual_minors)) ||
              sexualScore > sexualThreshold ||
              harassmentScore > 0.5;

            console.log('[Zen] Image moderation result', {
              result,
              flagged,
              sexual: categories.sexual,
              sexualScore,
              harassmentScore,
              decision: result ? '🔴 FILTER' : '✅ ALLOW'
            });

            API_CACHE.set(cacheKey, { result, timestamp: Date.now() });
            rateLimitUntil = 0;
            return result;
          } else if (moderationResponse.status === 429) {
            const retryAfter = moderationResponse.headers.get('retry-after');
            const waitSeconds = retryAfter ? parseInt(retryAfter) : 60;
            rateLimitUntil = Date.now() + (waitSeconds * 1000);

            console.warn(`[Zen] Rate limit hit (429), will retry after ${waitSeconds}s`, { attempt: attempt + 1 });
            lastError = new Error(`Rate limit: retry after ${waitSeconds}s`);

            if (attempt === 2) {
              console.log('[Zen] Max retries reached, failing open (not filtering)');
              return false;
            }
            continue;
          } else {
            const errorText = await moderationResponse.text();
            console.error('[Zen] Moderation API error', { status: moderationResponse.status, error: errorText });
            lastError = new Error(`API error: ${moderationResponse.status}`);
            break;
          }
        } catch (fetchError) {
          console.error('[Zen] Moderation API fetch error', { error: fetchError.message, attempt: attempt + 1 });
          lastError = fetchError;
          if (attempt < 2) continue;
          break;
        }
      }

      console.log('[Zen] Moderation API failed after retries, failing open', { error: lastError?.message });
      return false;
    }

    // Option 2: Use Vision API with configured provider
    const imageContent = imageBase64
      ? {
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${imageBase64}`
        }
      }
      : {
        type: 'image_url',
        image_url: {
          url: imageUrl
        }
      };

    console.log(`[Zen] Using ${provider.name} Vision API for detailed image analysis`);

    const systemPrompt = `You are a strict content moderation system. Your job is to detect "thirst trap" content - images designed to be sexually suggestive or attention-seeking.

FILTER (respond "yes") if the image contains:
- Selfies with revealing clothing or poses
- Body-focused photos (showing abs, curves, cleavage, etc)
- Sexually suggestive poses or expressions
- Photos clearly designed to attract sexual attention
- Bathroom/mirror selfies with revealing outfits
- Photos emphasizing physical appearance over content

ALLOW (respond "no") if the image contains:
- Regular photos of people fully clothed
- Professional headshots or casual photos
- Group photos, landscape, objects
- Memes, screenshots, art

Respond with ONLY "yes" or "no".`;

    const messages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Is this a thirst trap or sexually suggestive image?' },
          imageContent
        ]
      }
    ];

    const aiResponse = await callProviderAPI(providerId, provider, effectiveApiKey, messages, 10, true);
    const result = aiResponse.toLowerCase().includes('yes');

    console.log('[Zen] Vision API result', {
      provider: provider.name,
      aiResponse,
      result,
      decision: result ? '🔴 FILTER (thirst trap detected)' : '✅ ALLOW (safe content)'
    });

    API_CACHE.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  } catch (error) {
    console.error('[Zen] Image moderation error:', error);
    return false;
  }
};

// Check if text is about crypto using configured provider
const checkCryptoContent = async (text) => {
  if (!text || text.trim().length === 0) {
    console.log('[Zen] checkCryptoContent: empty text, skipping');
    return false;
  }

  const cacheKey = `text_${text.substring(0, 100)}`;
  const cached = API_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log('[Zen] Crypto detection cache HIT', { cacheKey, result: cached.result });
    return cached.result;
  }
  console.log('[Zen] Crypto detection cache MISS', { cacheKey, textPreview: text.substring(0, 50) });

  // Get provider config
  const { providerId, provider, apiKey } = await getProviderConfig('crypto');

  // Fallback to legacy API key if needed
  const effectiveApiKey = apiKey || await getApiKey();

  if (!effectiveApiKey) {
    console.error('[Zen] API key not configured for crypto detection');
    throw new Error('API key not configured');
  }

  console.log('[Zen] Using provider for crypto detection:', providerId);

  try {
    console.log('[Zen] Sending crypto detection request', { textLength: text.length });

    const messages = [
      {
        role: 'system',
        content: 'You are a content filter. Determine if the given text is about cryptocurrency, blockchain, NFTs, trading, or related topics. Respond with only "yes" or "no".'
      },
      {
        role: 'user',
        content: `Is this text about cryptocurrency or related topics? "${text}"`
      }
    ];

    const responseText = await callProviderAPI(providerId, provider, effectiveApiKey, messages, 10, false);
    const result = responseText.toLowerCase().includes('yes') || false;

    console.log('[Zen] Crypto detection result', {
      provider: provider.name,
      responseText,
      result,
      textPreview: text.substring(0, 50)
    });

    API_CACHE.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  } catch (error) {
    console.error('[Zen] Crypto detection error:', error);
    return false;
  }
};

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Zen] Background received message', { action: request.action, tabId: sender.tab?.id });

  if (request.action === 'checkImage') {
    console.log('[Zen] Processing image check request', {
      hasUrl: !!request.imageUrl,
      hasBase64: !!request.imageBase64,
      useFreeModeration: request.useFreeModeration
    });

    let responseSent = false;
    const safeSendResponse = (data) => {
      if (!responseSent) {
        try {
          const sent = sendResponse(data);
          responseSent = true;
          console.log('[Zen] Response sent successfully', { sent: sent !== false });
        } catch (e) {
          console.warn('[Zen] Failed to send response (channel closed)', { error: e.message });
          responseSent = true;
        }
      }
    };

    chrome.storage.local.get(['sexualThreshold'], (result) => {
      const sexualThreshold = result.sexualThreshold !== undefined ? result.sexualThreshold : 0.3;
      console.log('[Zen] Using sexualThreshold:', sexualThreshold);

      checkImageModeration(request.imageUrl, request.imageBase64, request.postText, request.useFreeModeration, sexualThreshold)
        .then(result => {
          console.log('[Zen] Image check completed', { result });
          safeSendResponse({ success: true, result });
        })
        .catch(error => {
          console.error('[Zen] Image check failed', { error: error.message });
          safeSendResponse({ success: false, error: error.message });
        });
    });

    return true;
  }

  if (request.action === 'checkCrypto') {
    console.log('[Zen] Processing crypto check request', { textLength: request.text?.length });

    let responseSent = false;
    const safeSendResponse = (data) => {
      if (!responseSent) {
        try {
          const sent = sendResponse(data);
          responseSent = true;
          console.log('[Zen] Response sent successfully', { sent: sent !== false });
        } catch (e) {
          console.warn('[Zen] Failed to send response (channel closed)', { error: e.message });
          responseSent = true;
        }
      }
    };

    checkCryptoContent(request.text)
      .then(result => {
        console.log('[Zen] Crypto check completed', { result });
        safeSendResponse({ success: true, result });
      })
      .catch(error => {
        console.error('[Zen] Crypto check failed', { error: error.message });
        safeSendResponse({ success: false, error: error.message });
      });

    return true;
  }

  if (request.action === 'testProvider') {
    console.log('[Zen] Testing provider connection', { provider: request.providerId });

    let responseSent = false;
    const safeSendResponse = (data) => {
      if (!responseSent) {
        try {
          sendResponse(data);
          responseSent = true;
        } catch (e) {
          responseSent = true;
        }
      }
    };

    (async () => {
      try {
        const { providerId, apiKey, customConfig } = request;
        let provider = { ...PROVIDERS[providerId] };

        if (providerId === 'custom') {
          provider.baseUrl = customConfig?.baseUrl || '';
          provider.models = {
            vision: customConfig?.visionModel || '',
            text: customConfig?.textModel || ''
          };
        }

        if (!apiKey) {
          throw new Error('API key is required');
        }

        if (providerId === 'custom' && !provider.baseUrl) {
          throw new Error('Base URL is required for custom provider');
        }

        const messages = [
          { role: 'user', content: 'Say "ok" if you can read this.' }
        ];

        const response = await callProviderAPI(providerId, provider, apiKey, messages, 10, false);
        console.log('[Zen] Provider test response:', response);

        safeSendResponse({ success: true, message: 'Connection successful' });
      } catch (error) {
        console.error('[Zen] Provider test failed:', error);
        safeSendResponse({ success: false, error: error.message });
      }
    })();

    return true;
  }

  console.log('[Zen] Unknown action', { action: request.action });
  return false;
});
