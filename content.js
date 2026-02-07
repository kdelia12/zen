// Main content script orchestrator for Zen extension

const loadSettings = async () => {
  const result = await chrome.storage.local.get([
    'enabled', 'mode', 'lockInMode', 'enableImageFilter', 'useFreeImageModeration',
    'enableKeywordFilter', 'enableCredibilityFilter', 'credibilityThreshold',
    'accountAllowlist', 'accountBlacklist', 'allowlist', 'blacklist',
    'scrollDelay', 'clickDelay', 'pauseDuration',
    'imageProvider', 'cryptoProvider', 'apiKeys', 'customProviderConfig'
  ]);

  enabled = result.enabled === true;
  mode = result.mode || 'default';
  lockInMode = result.lockInMode === true;
  enableImageFilter = result.enableImageFilter !== false;
  useFreeImageModeration = result.useFreeImageModeration !== undefined ? result.useFreeImageModeration : true;
  enableKeywordFilter = result.enableKeywordFilter !== false;
  enableCredibilityFilter = result.enableCredibilityFilter === true;
  credibilityThreshold = result.credibilityThreshold !== undefined ? result.credibilityThreshold : 1000;
  accountAllowlist = result.accountAllowlist || [];
  accountBlacklist = result.accountBlacklist || [];
  allowlist = result.allowlist || [];
  blacklist = result.blacklist || [];
  scrollDelay = result.scrollDelay || 2000;
  clickDelay = result.clickDelay || 3000;
  pauseDuration = result.pauseDuration || 5000;
  imageProvider = result.imageProvider || 'openai';
  cryptoProvider = result.cryptoProvider || 'openai';
  apiKeys = result.apiKeys || {};
  customProviderConfig = result.customProviderConfig || { baseUrl: '', visionModel: '', textModel: '' };

  if (enabled && mode === 'agent') startAgentMode();
  else stopAgentMode();
  if (enabled) processExistingPosts();
};

const processPost = async (postElement) => {
  if (!enabled || !postElement || postElement.hasAttribute('data-zen-processing')) return;
  if (isReply(postElement)) {
    postElement.setAttribute('data-zen-processing', 'true');
    return;
  }

  postElement.setAttribute('data-zen-processing', 'true');
  try {
    const result = await shouldFilterPost(postElement);
    const shouldFilter = typeof result === 'boolean' ? result : result.shouldFilter;
    const reason = typeof result === 'boolean' ? 'Filtered content' : (result.reason || 'Filtered content');
    if (mode === 'default' && shouldFilter) hidePost(postElement, reason);
  } catch (e) {
    console.error('[Zen] Error:', e.message);
  } finally {
    postElement.removeAttribute('data-zen-processing');
  }
};

const processExistingPosts = async () => {
  if (!enabled) return;
  document.querySelectorAll('article[data-testid="tweet"]').forEach(post => {
    if (!post.hasAttribute('data-zen-observed')) intersectionObserver.observe(post);
  });
};

const intersectionObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting && enabled) {
      const post = entry.target;
      if (!post.hasAttribute('data-zen-observed')) {
        post.setAttribute('data-zen-observed', 'true');
        processPost(post);
      }
      intersectionObserver.unobserve(post);
    }
  });
}, { rootMargin: '100px', threshold: 0.1 });

const observer = new MutationObserver((mutations) => {
  if (!enabled) return;
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node.nodeType === 1) {
        if (node.matches?.('article[data-testid="tweet"]')) intersectionObserver.observe(node);
        node.querySelectorAll?.('article[data-testid="tweet"]').forEach(post => intersectionObserver.observe(post));
      }
    });
  });
});

const init = async () => {
  await loadSettings();
  observer.observe(document.body, { childList: true, subtree: true });
  processExistingPosts();

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggle') {
      enabled = request.enabled;
      if (enabled) {
        processExistingPosts();
        if (mode === 'agent') startAgentMode();
      } else {
        stopAgentMode();
        document.querySelectorAll('[data-zen-filtered="true"]').forEach(post => showPost(post));
      }
    }
    if (request.action === 'modeChange') {
      mode = request.mode;
      stopAgentMode();
      if (enabled && mode === 'agent') startAgentMode();
      else processExistingPosts();
    }
    if (request.action === 'settingsUpdated') {
      loadSettings().then(() => {
        if (enabled) {
          processedPosts.clear();
          processExistingPosts();
        }
      });
    }
    sendResponse({ success: true });
  });
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
