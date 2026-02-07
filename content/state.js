// Global state for Zen extension
// Note: Using 'var' instead of 'let' to ensure global scope across all content script files

var enabled = false;
var mode = 'default';
var lockInMode = false;
var enableImageFilter = true;
var useFreeImageModeration = false;
var enableKeywordFilter = true;
var enableCredibilityFilter = false;
var credibilityThreshold = 1000;
var accountAllowlist = [];
var accountBlacklist = [];
var allowlist = [];
var blacklist = [];
var scrollDelay = 2000;
var clickDelay = 3000;
var pauseDuration = 5000;
var agentActive = false;

// Multi-provider support
var imageProvider = 'openai';
var cryptoProvider = 'openai';
var apiKeys = {}; // { openai: 'sk-...', claude: 'sk-ant-...', kimi: '...', custom: '...' }
var customProviderConfig = { baseUrl: '', visionModel: '', textModel: '' };
var lastUserInteraction = Date.now();
var processedPosts = new Map();
var hiddenPostsContent = new Map(); // Store original content for hidden posts

