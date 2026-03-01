# claude-telegram-bridge

A lightweight Node.js bridge that lets you run CLI AI providers from Telegram (or terminal input), with shared conversation history and optional automatic fallback from Claude to Codex.

## How it works

- `bridge normal`: local terminal mode with shared history and automatic provider fallback.
- `bridge passthrough`: direct CLI passthrough with full TTY graphics (no bridge history/fallback logic).
- `bridge telegram`: same engine, but controlled from Telegram.
- `bridge normal` and `bridge telegram` can switch provider manually (`/provider ...`) and automatically on limit/quota errors.

## Requirements

- Node.js 18+
- [Claude Code](https://claude.ai/code) installed and available as `claude` in PATH
- Codex CLI installed and available as `codex` in PATH (if you use Codex or fallback)
- A Telegram bot token (create one via [@BotFather](https://t.me/BotFather))
- Your Telegram chat ID (use [@userinfobot](https://t.me/userinfobot) to find it)

## Installation

```bash
git clone https://github.com/berg8201/claude-telegram-bridge.git
cd claude-telegram-bridge
npm install
npm link
npm run hooks:install
```

`npm link` is a one-time setup to make the `bridge` command available globally.
`npm run hooks:install` enables the repository `post-push` hook.

## Configuration

Recommended: use a global config in `~/.config/bridge` so `bridge` works the same in all projects.

```bash
mkdir -p ~/.config/bridge
cp /path/to/claude-telegram-bridge/.env.example ~/.config/bridge/.env
```

Then edit `~/.config/bridge/.env` with your values:

```env
BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN
CHAT_ID=YOUR_TELEGRAM_CHAT_ID
PRIMARY_PROVIDER=claude
FALLBACK_PROVIDER=codex
ENABLE_AUTO_FALLBACK=true
ENABLE_RISK_GUARD=true
AUTO_ROUTE_HIGH_RISK=true
RISK_HIGH_PROMPT_CHARS=1200
RISK_HIGH_HISTORY_TURNS=8
RISK_LIMIT_WINDOW_MINUTES=180
HISTORY_WINDOW=12
# Optional override. By default a per-project session file is auto-generated under ~/.config/bridge/sessions
# SESSION_FILE=/absolute/path/to/session.json
SUMMARY_MAX_TURNS=30
SUMMARY_MAX_CHARS=3500
CLAUDE_COMMAND=claude
CODEX_COMMAND=codex
CLAUDE_ARGS=--print
CODEX_ARGS=exec -
```

Alternative fallback: copy the example config and fill in your values:

```bash
cp /path/to/claude-telegram-bridge/config.example.json ~/.config/bridge/config.json
```

```json
{
  "botToken": "YOUR_TELEGRAM_BOT_TOKEN",
  "chatId": "YOUR_TELEGRAM_CHAT_ID",
  "primaryProvider": "claude",
  "fallbackProvider": "codex",
  "enableAutoFallback": true,
  "enableRiskGuard": true,
  "autoRouteHighRisk": true,
  "riskHighPromptChars": 1200,
  "riskHighHistoryTurns": 8,
  "riskLimitWindowMinutes": 180,
  "historyWindow": 12,
  "summaryMaxTurns": 30,
  "summaryMaxChars": 3500,
  "claudeCommand": "claude",
  "codexCommand": "codex",
  "claudeArgs": "--print",
  "codexArgs": "exec -"
}
```

| Field | Description |
| --------------------- | ------------------------------------------ |
| `botToken` | Telegram bot token from @BotFather (required for `bridge telegram`) |
| `chatId` | Your personal Telegram chat ID (required for `bridge telegram`) |
| `primaryProvider` | `claude` or `codex` |
| `fallbackProvider` | Provider used when fallback triggers |
| `enableAutoFallback` | `true`/`false`, auto Claude -> fallback on quota/rate-limit |
| `enableRiskGuard` | Enables preflight risk warnings based on recent limit events + job size |
| `autoRouteHighRisk` | Auto-routes medium/high risk jobs to fallback provider when risk guard triggers |
| `riskHighPromptChars` | Prompt length threshold used by risk guard |
| `riskHighHistoryTurns` | Recent context turns threshold used by risk guard |
| `riskLimitWindowMinutes` | How long a detected limit event keeps provider in high-risk state |
| `historyWindow` | Number of latest turns included as context |
| `sessionFile` | Optional explicit session file path. If unset, bridge uses a per-project file under `~/.config/bridge/sessions` |
| `summaryMaxTurns` | Number of recent turns used when building running summary |
| `summaryMaxChars` | Max summary size sent between providers |
| `claudeCommand` / `codexCommand` | CLI command names |
| `claudeArgs` / `codexArgs` | Space-separated CLI args (defaults: `claude=--print`, `codex=exec -`) |

Load order: environment variables override local project files (`./.env`, `./config.json`), which override global files (`~/.config/bridge/.env`, `~/.config/bridge/config.json`).

You can set a custom global folder with `BRIDGE_HOME`.

## Usage

Default mode (`normal`):

```bash
bridge
bridge normal
```

Examples:

```bash
bridge normal
bridge codex
bridge normal codex
bridge normal claude
```

Passthrough mode (full provider TTY/graphics):

```bash
bridge pass
bridge passthrough
bridge passthrough claude
bridge passthrough codex
bridge passthrough claude --model sonnet
```

Telegram mode:

```bash
bridge telegram
```

### Commands

- `/help` shows available bridge commands.
- `/provider` shows active provider.
- `/provider claude` switches to Claude.
- `/provider codex` switches to Codex.
- `/risk` shows provider risk/limit status.
- `/summary` shows the running persisted summary that is shared across providers.
- `/push [remote] [branch]` runs `git push` from current project.
- `/clear` clears in-memory conversation history.

## Notes

- `bridge normal` prioritizes reliability (shared history + auto-fallback), not full provider TUI rendering.
- `bridge passthrough` prioritizes original CLI experience and forwards arguments directly to provider command.
- Session history and summary persist across restarts in a per-project session file (or `SESSION_FILE` if explicitly set).

### Replying from Telegram

Any non-command text is treated as a prompt and run through the active provider.

## Git Push Notifications

After running `npm run hooks:install`, each successful `git push` in this repo sends a Telegram status message using your bridge config (`BOT_TOKEN`, `CHAT_ID`).
`/push` also triggers the same notifier as fallback, with dedupe to avoid double messages.

## License

MIT
