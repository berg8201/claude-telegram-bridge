# Security and Compliance Checklist

This project can be used lawfully, but only if your deployment follows provider terms and local privacy laws.

## Minimum Controls

- Use your own valid API/CLI credentials and follow each provider's Terms of Service.
- Process only data you are authorized to process.
- Inform users if prompts/messages are stored or forwarded to third-party AI providers.
- Protect secrets (`BOT_TOKEN`, provider credentials) and rotate them on suspected exposure.

## Recommended Bridge Settings

For a safer default profile, set:

```env
ENABLE_MUTATING_GIT_COMMANDS=false
REDACT_PROMPT_LOGS=true
ENABLE_SESSION_PERSISTENCE=false
```

## Data Handling

- If `ENABLE_SESSION_PERSISTENCE=true`, prompt/response history is written to the session file.
- If `ENABLE_SESSION_PERSISTENCE=false`, no session history is persisted by bridge.
- `REDACT_PROMPT_LOGS=true` redacts prompt content in local CLI status logs.

## Telegram Controls

- Configure a dedicated bot for bridge only.
- Restrict execution to your intended `CHAT_ID`.
- Treat Telegram as a remote control channel and protect account access (2FA, strong credentials).

## Operational Hardening

- Run on a server with least privilege and restricted network access.
- Keep dependencies and runtime (Node.js, provider CLIs) updated.
- Add monitoring/alerting for abnormal command patterns.
- Disable mutating git commands unless required for your workflow.

## Legal Reminder

You are responsible for compliance in your jurisdiction, including privacy and data protection obligations.
This file is practical guidance, not legal advice.
