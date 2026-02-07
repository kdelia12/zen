// Main content script orchestrator for Zen extension
// This file coordinates all modules: state, utils, filters, and agent

// Load settings from storage
const loadSettings = async () => {
  console.log('[Zen] Loading settings from storage');
  const result = await chrome.storage.local.get([
    'enabled',
    'mode',
    'lockInMode',
    'enableImageFilter',
    'useFreeImageModeration',
    'enableKeywordFilter',
    'enableCredibilityFilter',
    'credibilityThreshold',
    'accountAllowlist',
    'accountBlacklist',
    'allowlist',
    'blacklist',
    'scrollDelay',
    'clickDelay',
    'pauseDuration',
    'imageProvider',
    'cryptoProvider',
    'apiKeys',
    'customProviderConfig'
  ]);

  // Update global variables from state.js (they are declared with 'let' in state.js)
  // Since files are loaded in order, we can access and update these variables
  enabled = result.enabled === true; // Default to false
  mode = result.mode || 'default';
  lockInMode = result.lockInMode === true;
  enableImageFilter = result.enableImageFilter !== false; // Default true
  useFreeImageModeration = result.useFreeImageModeration !== undefined ? result.useFreeImageModeration : true; // Default true (free mode)
  enableKeywordFilter = result.enableKeywordFilter !== false; // Default true
  enableCredibilityFilter = result.enableCredibilityFilter === true; // Default false
  credibilityThreshold = result.credibilityThreshold !== undefined ? result.credibilityThreshold : 1000; // Default 1000
  accountAllowlist = result.accountAllowlist || [];
  accountBlacklist = result.accountBlacklist || [];
  allowlist = result.allowlist || [];
  blacklist = result.blacklist || [];
  scrollDelay = result.scrollDelay || 2000;
  clickDelay = result.clickDelay || 3000;
  pauseDuration = result.pauseDuration || 5000;

  // Provider settings
  imageProvider = result.imageProvider || 'openai';
  cryptoProvider = result.cryptoProvider || 'openai';
  apiKeys = result.apiKeys || {};
  customProviderConfig = result.customProviderConfig || { baseUrl: '', visionModel: '', textModel: '' };

  // Log to verify credibility filter is loaded
  console.log('[Zen] Credibility filter state:', {
    enableCredibilityFilter,
    credibilityThreshold,
    type: typeof enableCredibilityFilter
  });

  console.log('[Zen] Settings loaded', {
    enabled,
    mode,
    lockInMode,
    enableImageFilter,
    useFreeImageModeration,
    enableKeywordFilter,
    enableCredibilityFilter,
    credibilityThreshold,
    accountAllowlistCount: accountAllowlist.length,
    accountBlacklistCount: accountBlacklist.length,
    allowlistCount: allowlist.length,
    blacklistCount: blacklist.length,
    scrollDelay,
    clickDelay,
    pauseDuration,
    imageProvider,
    cryptoProvider
  });

  if (enabled && mode === 'agent') {
    console.log('[Zen] Starting agent mode');
    startAgentMode();
  } else {
    console.log('[Zen] Stopping agent mode');
    stopAgentMode();
  }

  if (enabled) {
    console.log('[Zen] Processing existing posts');
    processExistingPosts();
  } else {
    console.log('[Zen] Extension disabled, skipping post processing');
  }
};

// Process a single post - SEQUENTIAL (one at a time)
const processPost = async (postElement) => {
  if (!enabled || !postElement || postElement.hasAttribute('data-zen-processing')) {
    return;
  }

  // EARLY EXIT: Skip replies immediately (before any processing)
  if (isReply(postElement)) {
    postElement.setAttribute('data-zen-processing', 'true'); // Mark as processed
    return;
  }

  postElement.setAttribute('data-zen-processing', 'true');

  try {
    // AWAIT all filters sequentially - no parallel processing
    const result = await shouldFilterPost(postElement);

    // Handle both old format (boolean) and new format (object)
    let shouldFilter, reason;
    if (typeof result === 'boolean') {
      shouldFilter = result;
      reason = 'Filtered content';
    } else {
      shouldFilter = result.shouldFilter;
      reason = result.reason || 'Filtered content';
    }

    if (mode === 'default' && shouldFilter) {
      hidePost(postElement, reason);
    }
  } catch (error) {
    console.error('[Zen] Error processing post:', error);
  } finally {
    postElement.removeAttribute('data-zen-processing');
  }
};

// Process all existing posts on page
const processExistingPosts = async () => {
  if (!enabled) {
    console.log('[Zen] Extension disabled, skipping processExistingPosts');
    return;
  }

  const posts = document.querySelectorAll('article[data-testid="tweet"]');
  console.log('[Zen] Found existing posts, adding to intersection observer', { count: posts.length });

  // Add all existing posts to IntersectionObserver
  // They will be processed only when they enter viewport
  posts.forEach(post => {
    if (!post.hasAttribute('data-zen-observed')) {
      intersectionObserver.observe(post);
    }
  });

  console.log('[Zen] All existing posts added to observer');
};

// IntersectionObserver to only process posts in viewport
const intersectionObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting && enabled) {
      const post = entry.target;
      if (!post.hasAttribute('data-zen-observed')) {
        console.log('[Zen] Post entered viewport, processing...');
        post.setAttribute('data-zen-observed', 'true');
        processPost(post);
      }
      // Stop observing after processing
      intersectionObserver.unobserve(post);
    }
  });
}, {
  rootMargin: '100px', // Start loading 100px before entering viewport
  threshold: 0.1
});

// MutationObserver to detect new posts
const observer = new MutationObserver((mutations) => {
  if (!enabled) return;

  let newPostsCount = 0;
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node.nodeType === 1) { // Element node
        // Check if it's a post or contains posts
        if (node.matches && node.matches('article[data-testid="tweet"]')) {
          newPostsCount++;
          console.log('[Zen] New post detected, adding to intersection observer');
          // Use IntersectionObserver instead of immediate processing
          intersectionObserver.observe(node);
        }

        // Check for posts within the added node
        const posts = node.querySelectorAll?.('article[data-testid="tweet"]');
        if (posts && posts.length > 0) {
          newPostsCount += posts.length;
          console.log('[Zen] New posts detected in node', { count: posts.length });
          posts.forEach(post => {
            // Use IntersectionObserver instead of immediate processing
            intersectionObserver.observe(post);
          });
        }
      }
    });
  });

  if (newPostsCount > 0) {
    console.log('[Zen] MutationObserver found new posts', { count: newPostsCount });
  }
});

// Initialize extension
const init = async () => {
  console.log('[Zen] Initializing extension');
  await loadSettings();

  // Start observing
  console.log('[Zen] Starting MutationObserver for new posts');
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Process existing posts
  processExistingPosts();

  // Listen for messages from popup/options
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[Zen] Content script received message', { action: request.action });

    if (request.action === 'toggle') {
      console.log('[Zen] Toggle extension', { enabled: request.enabled });
      enabled = request.enabled;
      if (enabled) {
        console.log('[Zen] Extension enabled, processing posts');
        processExistingPosts();
        if (mode === 'agent') {
          console.log('[Zen] Starting agent mode');
          startAgentMode();
        }
      } else {
        console.log('[Zen] Extension disabled, stopping agent and showing posts');
        stopAgentMode();
        // Show all hidden posts
        const hiddenPosts = document.querySelectorAll('[data-zen-filtered="true"]');
        console.log('[Zen] Showing hidden posts', { count: hiddenPosts.length });
        hiddenPosts.forEach(post => {
          showPost(post);
        });
      }
    }

    if (request.action === 'modeChange') {
      console.log('[Zen] Mode changed', { oldMode: mode, newMode: request.mode });
      mode = request.mode;
      stopAgentMode();
      if (enabled && mode === 'agent') {
        console.log('[Zen] Starting agent mode');
        startAgentMode();
      } else {
        console.log('[Zen] Processing posts in default mode');
        processExistingPosts();
      }
    }

    if (request.action === 'settingsUpdated') {
      console.log('[Zen] Settings updated, reloading');
      loadSettings().then(() => {
        // Reprocess all posts with new settings
        if (enabled) {
          console.log('[Zen] Clearing cache and reprocessing posts');
          processedPosts.clear(); // Clear cache
          processExistingPosts();
        }
      });
    }

    sendResponse({ success: true });
  });

  console.log('[Zen] Extension initialized successfully');
};

// Wait for page to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
