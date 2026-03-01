# claude-telegram-bridge

A lightweight Node.js wrapper around [Claude Code](https://claude.ai/code) that forwards approval prompts to your phone via Telegram — so you can step away from your desk without blocking a long-running session.

## How it works

When Claude Code asks for input (e.g. `allow`, `deny`, `y/n`, `proceed?`), the bridge starts a configurable timer (default: 30 seconds). If you respond locally within that window, the session continues as normal. If no local input is given, the prompt is forwarded to your Telegram chat and you can reply from your phone. Claude Code resumes automatically once it receives your answer.

```
┌──────────────┐     spawns      ┌─────────────┐
│    bridge    │ ─────────────►  │ Claude Code │
│   (Node.js)  │ ◄─────────────  │             │
└──────┬───────┘   stdout/stdin  └─────────────┘
       │
       │  no local input within timeout
       ▼
┌──────────────┐
│   Telegram   │  ◄──  prompt forwarded
│     Bot      │  ──►  your reply
└──────────────┘
```

## Requirements

- Node.js 18+
- [Claude Code](https://claude.ai/code) installed and available as `claude` in PATH
- A Telegram bot token (create one via [@BotFather](https://t.me/BotFather))
- Your Telegram chat ID (use [@userinfobot](https://t.me/userinfobot) to find it)

## Installation

```bash
git clone https://github.com/berg8201/claude-telegram-bridge.git
cd claude-telegram-bridge
npm install
```

## Configuration

Copy the example config and fill in your values:

```bash
cp config.example.json config.json
```

```json
{
  "botToken": "YOUR_TELEGRAM_BOT_TOKEN",
  "chatId": "YOUR_TELEGRAM_CHAT_ID",
  "timeoutSeconds": 30
}
```

| Field            | Description                                                  |
| ---------------- | ------------------------------------------------------------ |
| `botToken`       | Telegram bot token from @BotFather                           |
| `chatId`         | Your personal Telegram chat ID                               |
| `timeoutSeconds` | Seconds to wait for local input before forwarding to Telegram |

> **Important:** `config.json` is listed in `.gitignore` and should never be committed.

## Usage

Use `bridge.js` in place of the `claude` command and pass the same arguments:

```bash
node bridge.js [claude arguments]
```

**Examples:**

```bash
# Start an interactive Claude Code session
node bridge.js

# Run Claude Code on a specific task
node bridge.js --print "Refactor src/index.js"
```

Once running, the bridge sends a startup message to your Telegram chat confirming it is active.

### Replying from Telegram

When a prompt is forwarded, reply directly in the chat with your answer (e.g. `y`, `n`, or free text). The bridge will feed your reply to Claude Code and confirm the input was sent.

You can also send input at any time using the `/run` command:

```
/run y
```

## License

MIT
