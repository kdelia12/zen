// Options page script for Zen extension

const DEFAULT_ALLOWLIST = [
  'crypto', 'cryptocurrency', 'bitcoin', 'btc', 'ethereum', 'eth',
  'nft', 'defi', 'web3', 'blockchain', 'altcoin', 'trading',
  'hodl', 'moon', 'pump', 'dump'
];

const DEFAULT_BLACKLIST = [];

document.addEventListener('DOMContentLoaded', async () => {
  // Load saved settings
  const loadSettings = async () => {
    const result = await chrome.storage.local.get([
      'apiKey', // Legacy
      'apiKeys',
      'imageProvider',
      'cryptoProvider',
      'customProviderConfig',
      'enabled',
      'mode',
      'lockInMode',
      'enableImageFilter',
      'useFreeImageModeration',
      'sexualThreshold',
      'enableKeywordFilter',
      'enableCredibilityFilter',
      'credibilityThreshold',
      'accountAllowlist',
      'accountBlacklist',
      'allowlist',
      'blacklist',
      'scrollDelay',
      'clickDelay',
      'pauseDuration'
    ]);

    // Provider settings
    document.getElementById('imageProvider').value = result.imageProvider || 'openai';
    document.getElementById('cryptoProvider').value = result.cryptoProvider || 'openai';

    // API Keys (with legacy fallback)
    const apiKeys = result.apiKeys || {};
    document.getElementById('openaiApiKey').value = apiKeys.openai || result.apiKey || '';
    document.getElementById('claudeApiKey').value = apiKeys.claude || '';
    document.getElementById('kimiApiKey').value = apiKeys.kimi || '';
    document.getElementById('customApiKey').value = apiKeys.custom || '';

    // Custom provider config
    const customConfig = result.customProviderConfig || {};
    document.getElementById('customBaseUrl').value = customConfig.baseUrl || '';
    document.getElementById('customVisionModel').value = customConfig.visionModel || '';
    document.getElementById('customTextModel').value = customConfig.textModel || '';

    // Update provider config visibility
    updateProviderVisibility();

    document.getElementById('enableToggle').checked = result.enabled !== false;
    document.getElementById('lockInMode').checked = result.lockInMode === true;
    document.getElementById('enableImageFilter').checked = result.enableImageFilter !== false;
    document.getElementById('useFreeImageModeration').checked = result.useFreeImageModeration !== undefined ? result.useFreeImageModeration : true;
    document.getElementById('sexualThreshold').value = result.sexualThreshold !== undefined ? result.sexualThreshold : 0.3;
    document.getElementById('enableKeywordFilter').checked = result.enableKeywordFilter !== false;
    document.getElementById('enableCredibilityFilter').checked = result.enableCredibilityFilter === true;
    document.getElementById('credibilityThreshold').value = result.credibilityThreshold !== undefined ? result.credibilityThreshold : 1000;

    const mode = result.mode || 'default';
    const modeRadio = document.getElementById(`mode${mode.charAt(0).toUpperCase() + mode.slice(1)}`);
    if (modeRadio) {
      modeRadio.checked = true;
    }
    updateAgentSettingsVisibility(mode);

    document.getElementById('accountAllowlist').value = (result.accountAllowlist || []).join('\n');
    document.getElementById('accountBlacklist').value = (result.accountBlacklist || []).join('\n');
    document.getElementById('allowlist').value = (result.allowlist || DEFAULT_ALLOWLIST).join('\n');
    document.getElementById('blacklist').value = (result.blacklist || DEFAULT_BLACKLIST).join('\n');
    document.getElementById('scrollDelay').value = result.scrollDelay || 2000;
    document.getElementById('clickDelay').value = result.clickDelay || 3000;
    document.getElementById('pauseDuration').value = result.pauseDuration || 5000;
  };

  const updateAgentSettingsVisibility = (mode) => {
    const agentSettings = document.getElementById('agentSettings');
    if (agentSettings) {
      agentSettings.style.display = mode === 'agent' ? 'block' : 'none';
    }
  };

  // Update visibility of provider config sections based on selected providers
  const updateProviderVisibility = () => {
    const imageProvider = document.getElementById('imageProvider').value;
    const cryptoProvider = document.getElementById('cryptoProvider').value;
    const usedProviders = new Set([imageProvider, cryptoProvider]);

    // Show/hide provider configs based on what's being used
    document.getElementById('openaiConfig').style.display = usedProviders.has('openai') ? 'block' : 'none';
    document.getElementById('claudeConfig').style.display = usedProviders.has('claude') ? 'block' : 'none';
    document.getElementById('kimiConfig').style.display = usedProviders.has('kimi') ? 'block' : 'none';
    document.getElementById('customConfig').style.display = usedProviders.has('custom') ? 'block' : 'none';

    // Update free moderation visibility (only available for OpenAI)
    const freeModRow = document.getElementById('useFreeImageModeration').closest('.toggle-row');
    if (freeModRow) {
      freeModRow.style.display = imageProvider === 'openai' ? 'flex' : 'none';
    }
  };

  // Provider selection change handlers
  document.getElementById('imageProvider').addEventListener('change', updateProviderVisibility);
  document.getElementById('cryptoProvider').addEventListener('change', updateProviderVisibility);

  // Mode radio buttons
  document.querySelectorAll('input[name="mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      updateAgentSettingsVisibility(e.target.value);
    });
  });

  // Test provider connection
  const testProvider = async (providerId, statusElementId) => {
    const statusEl = document.getElementById(statusElementId);
    statusEl.textContent = 'Testing...';
    statusEl.style.color = 'var(--text-secondary)';

    let apiKey, customConfig;

    switch (providerId) {
      case 'openai':
        apiKey = document.getElementById('openaiApiKey').value.trim();
        break;
      case 'claude':
        apiKey = document.getElementById('claudeApiKey').value.trim();
        break;
      case 'kimi':
        apiKey = document.getElementById('kimiApiKey').value.trim();
        break;
      case 'custom':
        apiKey = document.getElementById('customApiKey').value.trim();
        customConfig = {
          baseUrl: document.getElementById('customBaseUrl').value.trim(),
          visionModel: document.getElementById('customVisionModel').value.trim(),
          textModel: document.getElementById('customTextModel').value.trim()
        };
        break;
    }

    if (!apiKey) {
      statusEl.textContent = '✗ Please enter an API key';
      statusEl.style.color = 'var(--danger)';
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'testProvider',
        providerId,
        apiKey,
        customConfig
      });

      if (response.success) {
        statusEl.textContent = '✓ Connected';
        statusEl.style.color = 'var(--success)';
      } else {
        statusEl.textContent = `✗ ${response.error || 'Connection failed'}`;
        statusEl.style.color = 'var(--danger)';
      }
    } catch (error) {
      statusEl.textContent = `✗ ${error.message}`;
      statusEl.style.color = 'var(--danger)';
    }
  };

  // Test buttons
  document.getElementById('testOpenai').addEventListener('click', () => testProvider('openai', 'openaiStatus'));
  document.getElementById('testClaude').addEventListener('click', () => testProvider('claude', 'claudeStatus'));
  document.getElementById('testKimi').addEventListener('click', () => testProvider('kimi', 'kimiStatus'));
  document.getElementById('testCustom').addEventListener('click', () => testProvider('custom', 'customStatus'));

  // Reset account allowlist
  document.getElementById('resetAccountAllowlist').addEventListener('click', () => {
    document.getElementById('accountAllowlist').value = '';
  });

  // Clear account blacklist
  document.getElementById('resetAccountBlacklist').addEventListener('click', () => {
    document.getElementById('accountBlacklist').value = '';
  });

  // Reset keyword allowlist
  document.getElementById('resetAllowlist').addEventListener('click', () => {
    document.getElementById('allowlist').value = DEFAULT_ALLOWLIST.join('\n');
  });

  // Clear keyword blacklist
  document.getElementById('resetBlacklist').addEventListener('click', () => {
    document.getElementById('blacklist').value = '';
  });

  // Export settings
  document.getElementById('exportBtn').addEventListener('click', async () => {
    try {
      const result = await chrome.storage.local.get(null);

      const exportData = {
        version: '1.1.0',
        exportDate: new Date().toISOString(),
        settings: {
          enabled: result.enabled,
          mode: result.mode,
          lockInMode: result.lockInMode,
          enableImageFilter: result.enableImageFilter,
          useFreeImageModeration: result.useFreeImageModeration,
          sexualThreshold: result.sexualThreshold,
          enableKeywordFilter: result.enableKeywordFilter,
          enableCredibilityFilter: result.enableCredibilityFilter,
          credibilityThreshold: result.credibilityThreshold,
          accountAllowlist: result.accountAllowlist || [],
          accountBlacklist: result.accountBlacklist || [],
          allowlist: result.allowlist || [],
          blacklist: result.blacklist || [],
          scrollDelay: result.scrollDelay,
          clickDelay: result.clickDelay,
          pauseDuration: result.pauseDuration,
          // New provider settings (without API keys for security)
          imageProvider: result.imageProvider,
          cryptoProvider: result.cryptoProvider,
          customProviderConfig: result.customProviderConfig
        }
      };

      const json = JSON.stringify(exportData, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `zen-settings-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showStatus('Settings exported successfully!', 'success');
    } catch (error) {
      console.error('Export error:', error);
      showStatus('Failed to export settings: ' + error.message, 'error');
    }
  });

  // Import settings
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });

  document.getElementById('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const importStatus = document.getElementById('importStatus');
    importStatus.style.display = 'block';
    importStatus.textContent = 'Reading file...';
    importStatus.className = 'helper-text';
    importStatus.style.color = 'var(--text-secondary)';

    try {
      const text = await file.text();
      const importData = JSON.parse(text);

      if (!importData.settings) {
        throw new Error('Invalid settings file format');
      }

      const settings = importData.settings;

      if (typeof settings.enabled !== 'undefined') {
        document.getElementById('enableToggle').checked = settings.enabled !== false;
      }

      if (settings.mode) {
        const modeRadio = document.getElementById(`mode${settings.mode.charAt(0).toUpperCase() + settings.mode.slice(1)}`);
        if (modeRadio) modeRadio.checked = true;
        updateAgentSettingsVisibility(settings.mode);
      }

      if (typeof settings.lockInMode !== 'undefined') {
        document.getElementById('lockInMode').checked = settings.lockInMode === true;
      }

      if (typeof settings.enableImageFilter !== 'undefined') {
        document.getElementById('enableImageFilter').checked = settings.enableImageFilter !== false;
      }

      if (typeof settings.useFreeImageModeration !== 'undefined') {
        document.getElementById('useFreeImageModeration').checked = settings.useFreeImageModeration === true;
      }

      if (typeof settings.sexualThreshold !== 'undefined') {
        document.getElementById('sexualThreshold').value = settings.sexualThreshold;
      }

      if (typeof settings.enableKeywordFilter !== 'undefined') {
        document.getElementById('enableKeywordFilter').checked = settings.enableKeywordFilter !== false;
      }

      if (typeof settings.enableCredibilityFilter !== 'undefined') {
        document.getElementById('enableCredibilityFilter').checked = settings.enableCredibilityFilter === true;
      }

      if (typeof settings.credibilityThreshold !== 'undefined') {
        document.getElementById('credibilityThreshold').value = settings.credibilityThreshold;
      }

      if (settings.accountAllowlist && Array.isArray(settings.accountAllowlist)) {
        document.getElementById('accountAllowlist').value = settings.accountAllowlist.join('\n');
      }

      if (settings.accountBlacklist && Array.isArray(settings.accountBlacklist)) {
        document.getElementById('accountBlacklist').value = settings.accountBlacklist.join('\n');
      }

      if (settings.allowlist && Array.isArray(settings.allowlist)) {
        document.getElementById('allowlist').value = settings.allowlist.join('\n');
      }

      if (settings.blacklist && Array.isArray(settings.blacklist)) {
        document.getElementById('blacklist').value = settings.blacklist.join('\n');
      }

      if (typeof settings.scrollDelay !== 'undefined') {
        document.getElementById('scrollDelay').value = settings.scrollDelay;
      }

      if (typeof settings.clickDelay !== 'undefined') {
        document.getElementById('clickDelay').value = settings.clickDelay;
      }

      if (typeof settings.pauseDuration !== 'undefined') {
        document.getElementById('pauseDuration').value = settings.pauseDuration;
      }

      // Import provider settings
      if (settings.imageProvider) {
        document.getElementById('imageProvider').value = settings.imageProvider;
      }

      if (settings.cryptoProvider) {
        document.getElementById('cryptoProvider').value = settings.cryptoProvider;
      }

      if (settings.customProviderConfig) {
        document.getElementById('customBaseUrl').value = settings.customProviderConfig.baseUrl || '';
        document.getElementById('customVisionModel').value = settings.customProviderConfig.visionModel || '';
        document.getElementById('customTextModel').value = settings.customProviderConfig.textModel || '';
      }

      updateProviderVisibility();

      importStatus.textContent = '✅ Settings imported successfully! Click "Save Settings" to apply.';
      importStatus.className = 'helper-text success';
      importStatus.style.color = 'var(--success)';

      e.target.value = '';

    } catch (error) {
      console.error('Import error:', error);
      importStatus.textContent = '❌ Failed to import settings: ' + error.message;
      importStatus.className = 'helper-text error';
      importStatus.style.color = 'var(--danger)';
      e.target.value = '';
    }
  });

  // Save settings
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const enabled = document.getElementById('enableToggle').checked;
    const lockInMode = document.getElementById('lockInMode').checked;
    const enableImageFilter = document.getElementById('enableImageFilter').checked;
    const useFreeImageModeration = document.getElementById('useFreeImageModeration').checked;
    const sexualThreshold = parseFloat(document.getElementById('sexualThreshold').value) || 0.3;
    const enableKeywordFilter = document.getElementById('enableKeywordFilter').checked;
    const enableCredibilityFilter = document.getElementById('enableCredibilityFilter').checked;
    const credibilityThreshold = parseInt(document.getElementById('credibilityThreshold').value) || 1000;
    const mode = document.querySelector('input[name="mode"]:checked').value;

    // Provider settings
    const imageProvider = document.getElementById('imageProvider').value;
    const cryptoProvider = document.getElementById('cryptoProvider').value;

    // Collect API keys
    const apiKeys = {
      openai: document.getElementById('openaiApiKey').value.trim(),
      claude: document.getElementById('claudeApiKey').value.trim(),
      kimi: document.getElementById('kimiApiKey').value.trim(),
      custom: document.getElementById('customApiKey').value.trim()
    };

    // Custom provider config
    const customProviderConfig = {
      baseUrl: document.getElementById('customBaseUrl').value.trim(),
      visionModel: document.getElementById('customVisionModel').value.trim(),
      textModel: document.getElementById('customTextModel').value.trim()
    };

    // Parse account lists
    const accountAllowlistText = document.getElementById('accountAllowlist').value.trim();
    const accountAllowlist = accountAllowlistText.split('\n')
      .map(k => k.trim().replace(/^@/, '').toLowerCase())
      .filter(k => k.length > 0);

    const accountBlacklistText = document.getElementById('accountBlacklist').value.trim();
    const accountBlacklist = accountBlacklistText.split('\n')
      .map(k => k.trim().replace(/^@/, '').toLowerCase())
      .filter(k => k.length > 0);

    // Parse keyword lists
    const allowlistText = document.getElementById('allowlist').value.trim();
    const allowlist = allowlistText.split('\n')
      .map(k => k.trim())
      .filter(k => k.length > 0);

    const blacklistText = document.getElementById('blacklist').value.trim();
    const blacklist = blacklistText.split('\n')
      .map(k => k.trim())
      .filter(k => k.length > 0);

    const scrollDelay = parseInt(document.getElementById('scrollDelay').value) || 2000;
    const clickDelay = parseInt(document.getElementById('clickDelay').value) || 3000;
    const pauseDuration = parseInt(document.getElementById('pauseDuration').value) || 5000;

    // Validation
    if (!enableImageFilter && !enableKeywordFilter && !lockInMode && !enableCredibilityFilter) {
      showStatus('Please enable at least one filter feature', 'error');
      return;
    }

    // Check API keys for selected providers
    const requiredProviders = new Set();
    if (enableImageFilter && !useFreeImageModeration) {
      requiredProviders.add(imageProvider);
    }
    if (lockInMode) {
      requiredProviders.add(cryptoProvider);
    }

    for (const provider of requiredProviders) {
      if (!apiKeys[provider]) {
        showStatus(`API key required for ${provider.charAt(0).toUpperCase() + provider.slice(1)}`, 'error');
        return;
      }
    }

    // Free moderation still needs OpenAI key
    if (enableImageFilter && useFreeImageModeration && imageProvider === 'openai' && !apiKeys.openai) {
      showStatus('OpenAI API key required (Moderation API is free but needs API key)', 'error');
      return;
    }

    // Custom provider validation
    if (requiredProviders.has('custom')) {
      if (!customProviderConfig.baseUrl) {
        showStatus('Base URL required for custom provider', 'error');
        return;
      }
      if (!customProviderConfig.textModel) {
        showStatus('Text model required for custom provider', 'error');
        return;
      }
    }

    // Check keywords
    if (enableKeywordFilter && allowlist.length === 0 && blacklist.length === 0) {
      showStatus('Please add at least one keyword in allowlist or blacklist', 'error');
      return;
    }

    await chrome.storage.local.set({
      apiKey: apiKeys.openai, // Legacy compatibility
      apiKeys,
      imageProvider,
      cryptoProvider,
      customProviderConfig,
      enabled,
      lockInMode,
      enableImageFilter,
      useFreeImageModeration,
      sexualThreshold,
      enableKeywordFilter,
      enableCredibilityFilter,
      credibilityThreshold,
      mode,
      accountAllowlist,
      accountBlacklist,
      allowlist,
      blacklist,
      scrollDelay,
      clickDelay,
      pauseDuration
    });

    showStatus('Settings saved successfully!', 'success');

    // Notify content scripts
    const tabs = await chrome.tabs.query({ url: ['https://twitter.com/*', 'https://x.com/*'] });
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { action: 'settingsUpdated' }).catch(() => { });
    });
  });

  // Cancel button
  document.getElementById('cancelBtn').addEventListener('click', () => {
    window.close();
  });

  const showStatus = (message, type) => {
    const statusEl = document.getElementById('saveStatus');
    statusEl.textContent = message;
    statusEl.style.color = type === 'success' ? 'var(--success)' : 'var(--danger)';
    setTimeout(() => {
      statusEl.textContent = '';
    }, 3000);
  };

  // Load settings on page load
  loadSettings();
});
