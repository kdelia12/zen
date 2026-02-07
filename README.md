# Zen

Chrome extension. Filters garbage on Twitter/X. Thirst traps, crypto spam, low-credibility accounts. Gone.

## What it does

- **Image filter** - Detects thirst traps and attention-seeking selfies
- **Lock-in mode** - Shows ONLY crypto content, hides everything else. For when you need to focus
- **Keyword filter** - Block or allow posts by keywords
- **Credibility filter** - Hides accounts below a credibility threshold (Ethos Network)
- **Agent mode** - Auto-scrolls and clicks "not interested" for you

## Providers

Supports multiple AI backends. Pick what you have.

| Provider | Image Filter | Crypto Detection |
|----------|--------------|------------------|
| OpenAI | GPT-4o-mini | GPT-4o-mini |
| Claude | Sonnet 4 | Haiku 4 |
| Kimi | Moonshot Vision | Moonshot |
| Custom | Any OpenAI-compatible endpoint | Same |

OpenAI also has a free Moderation API option. No credits needed, just an API key.

## Install

1. `chrome://extensions/`
2. Enable "Developer mode"
3. "Load unpacked" → select this folder
4. Click extension icon → Settings
5. Add your API key(s)
6. Save

## Config

### Lock-in Mode
Off = hides crypto posts. On = hides everything except crypto. Simple.

### Keywords
Default list covers crypto terms. Edit in settings. One per line.

### Agent Mode
Set scroll delay, click delay, pause duration. It pauses when you touch the mouse or keyboard.

### Credibility Filter
Uses Ethos Network scores. Set minimum threshold. Accounts below it get hidden.

## Storage

All local. Nothing leaves your browser except API calls to your chosen provider.

- API keys stored in `chrome.storage.local`
- Results cached 5 minutes
- No telemetry

## Troubleshooting

Not working? Check:
1. Extension enabled?
2. API key valid?
3. Right provider selected?
4. On twitter.com or x.com?

Check console logs. Everything prefixed with `[Zen]`.

## License

MIT
