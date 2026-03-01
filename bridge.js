#!/usr/bin/env node

const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const TelegramBot = require("node-telegram-bot-api");

const USE_COLOR = Boolean(process.stdout.isTTY && process.env.TERM !== "dumb");

function paint(code, text) {
  if (!USE_COLOR) return text;
  return `\u001b[${code}m${text}\u001b[0m`;
}

function dim(text) {
  return paint("2", text);
}

function info(text) {
  return `${paint("36", "ℹ")} ${text}`;
}

function success(text) {
  return `${paint("32", "✔")} ${text}`;
}

function warn(text) {
  return `${paint("33", "⚠")} ${text}`;
}

function errorLabel(text) {
  return `${paint("31", "✖")} ${text}`;
}

function printNormalBanner(providerName) {
  const title = paint("1;36", "Bridge Normal Mode");
  const provider = paint("1", providerName);
  console.log(`${title} ${dim(`(provider: ${provider})`)}`);
  console.log(
    dim(
      'Commands: /help /status /doctor /checkpoint [name] /checkpoints /rollback [target] /provider /provider claude /provider codex /risk /summary /commit "msg" /push [remote] [branch] /clear'
    )
  );
}

function normalHelpText() {
  return [
    "Kommandon:",
    "  /help                         Visa hjälp",
    "  /status                       Visa bridge-status",
    "  /doctor                       Kör snabba hälsokontroller",
    "  /checkpoint [name]            Skapa checkpoint på nuvarande commit",
    "  /checkpoints                  Lista checkpoints",
    "  /rollback [id|name|sha]       Byt till ny rollback-branch vid checkpoint",
    "  /provider                     Visa aktiv provider",
    "  /provider claude|codex        Byt provider",
    "  /risk                         Visa risk/limit-status",
    "  /summary                      Visa sammanfattning",
    '  /commit "message"             Add+commit alla ändringar',
    "  /push [remote] [branch]       Kör git push",
    "  /clear                        Rensa historik",
  ].join("\n");
}

function loadDotEnvFile(envPath, overwrite = false) {
  if (!fs.existsSync(envPath)) return;
  let content = "";
  try {
    content = fs.readFileSync(envPath, "utf8");
  } catch (error) {
    console.error(`[bridge] Kunde inte läsa env-fil (${envPath}): ${error.message}`);
    process.exit(1);
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (overwrite || !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function bridgeHomeDir() {
  return process.env.BRIDGE_HOME || path.join(os.homedir(), ".config", "bridge");
}

function projectSessionFileDefault() {
  const cwd = process.cwd();
  const projectName = path.basename(cwd) || "workspace";
  const safeProjectName = projectName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const cwdHash = crypto.createHash("sha1").update(cwd).digest("hex").slice(0, 12);
  return path.join(bridgeHomeDir(), "sessions", `${safeProjectName}-${cwdHash}.json`);
}

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function loadDotEnv() {
  const homeDir = bridgeHomeDir();
  const globalEnv = path.join(homeDir, ".env");
  const localEnv = path.join(process.cwd(), ".env");
  loadDotEnvFile(globalEnv, false);
  loadDotEnvFile(localEnv, true);
}

function normalizeProvider(value) {
  return (value || "").trim().toLowerCase();
}

function parseCliArgs() {
  const args = process.argv.slice(2);
  const knownModes = ["normal", "telegram", "passthrough", "passthru", "pass"];

  if (args.length === 0) {
    return { mode: "normal", rest: [] };
  }

  const first = (args[0] || "").toLowerCase();
  if (knownModes.includes(first)) {
    const mappedMode = ["passthru", "pass"].includes(first) ? "passthrough" : first;
    return { mode: mappedMode, rest: args.slice(1) };
  }

  return { mode: "normal", rest: args };
}

function loadConfig(mode) {
  const homeDir = bridgeHomeDir();
  const globalConfigPath = path.join(homeDir, "config.json");
  const localConfigPath = path.join(process.cwd(), "config.json");
  const globalConfig = safeReadJson(globalConfigPath, {});
  const localConfig = safeReadJson(localConfigPath, {});
  const fileConfig = { ...globalConfig, ...localConfig };

  const config = {
    botToken: process.env.BOT_TOKEN || fileConfig.botToken,
    chatId: process.env.CHAT_ID || fileConfig.chatId,
    primaryProvider:
      (process.env.PRIMARY_PROVIDER || fileConfig.primaryProvider || "claude").toLowerCase(),
    fallbackProvider:
      (process.env.FALLBACK_PROVIDER || fileConfig.fallbackProvider || "codex").toLowerCase(),
    enableAutoFallback:
      String(process.env.ENABLE_AUTO_FALLBACK || fileConfig.enableAutoFallback || "true")
        .toLowerCase() !== "false",
    historyWindow: Number(process.env.HISTORY_WINDOW || fileConfig.historyWindow || 12),
    claudeCommand: process.env.CLAUDE_COMMAND || fileConfig.claudeCommand || "claude",
    codexCommand: process.env.CODEX_COMMAND || fileConfig.codexCommand || "codex",
    claudeArgs: process.env.CLAUDE_ARGS || fileConfig.claudeArgs || "--print",
    codexArgs: process.env.CODEX_ARGS || fileConfig.codexArgs || "exec -",
    sessionFile:
      process.env.SESSION_FILE ||
      fileConfig.sessionFile ||
      projectSessionFileDefault(),
    summaryMaxTurns: Number(process.env.SUMMARY_MAX_TURNS || fileConfig.summaryMaxTurns || 30),
    summaryMaxChars: Number(process.env.SUMMARY_MAX_CHARS || fileConfig.summaryMaxChars || 3500),
    enableRiskGuard:
      String(process.env.ENABLE_RISK_GUARD || fileConfig.enableRiskGuard || "true").toLowerCase() !==
      "false",
    riskHighPromptChars: Number(
      process.env.RISK_HIGH_PROMPT_CHARS || fileConfig.riskHighPromptChars || 1200
    ),
    riskHighHistoryTurns: Number(
      process.env.RISK_HIGH_HISTORY_TURNS || fileConfig.riskHighHistoryTurns || 8
    ),
    riskLimitWindowMinutes: Number(
      process.env.RISK_LIMIT_WINDOW_MINUTES || fileConfig.riskLimitWindowMinutes || 180
    ),
    autoRouteHighRisk:
      String(process.env.AUTO_ROUTE_HIGH_RISK || fileConfig.autoRouteHighRisk || "true")
        .toLowerCase() !== "false",
  };

  if (!["claude", "codex"].includes(config.primaryProvider)) {
    console.error("[bridge] PRIMARY_PROVIDER måste vara 'claude' eller 'codex'.");
    process.exit(1);
  }

  if (!["claude", "codex"].includes(config.fallbackProvider)) {
    console.error("[bridge] FALLBACK_PROVIDER måste vara 'claude' eller 'codex'.");
    process.exit(1);
  }

  if (config.historyWindow < 0 || Number.isNaN(config.historyWindow)) {
    console.error("[bridge] HISTORY_WINDOW måste vara 0 eller större.");
    process.exit(1);
  }

  if (config.summaryMaxTurns < 1 || Number.isNaN(config.summaryMaxTurns)) {
    console.error("[bridge] SUMMARY_MAX_TURNS måste vara 1 eller större.");
    process.exit(1);
  }

  if (config.summaryMaxChars < 200 || Number.isNaN(config.summaryMaxChars)) {
    console.error("[bridge] SUMMARY_MAX_CHARS måste vara minst 200.");
    process.exit(1);
  }

  if (config.riskHighPromptChars < 1 || Number.isNaN(config.riskHighPromptChars)) {
    console.error("[bridge] RISK_HIGH_PROMPT_CHARS måste vara 1 eller större.");
    process.exit(1);
  }

  if (config.riskHighHistoryTurns < 0 || Number.isNaN(config.riskHighHistoryTurns)) {
    console.error("[bridge] RISK_HIGH_HISTORY_TURNS måste vara 0 eller större.");
    process.exit(1);
  }

  if (config.riskLimitWindowMinutes < 1 || Number.isNaN(config.riskLimitWindowMinutes)) {
    console.error("[bridge] RISK_LIMIT_WINDOW_MINUTES måste vara 1 eller större.");
    process.exit(1);
  }

  if (!path.isAbsolute(config.sessionFile)) {
    config.sessionFile = path.join(homeDir, config.sessionFile);
  }

  ensureParentDir(config.sessionFile);

  if (mode === "telegram") {
    if (!config.botToken) {
      console.error("[bridge] Saknar bot-token. Sätt BOT_TOKEN eller config.json.botToken.");
      process.exit(1);
    }

    if (!config.chatId) {
      console.error("[bridge] Saknar chat-id. Sätt CHAT_ID eller config.json.chatId.");
      process.exit(1);
    }
  }

  return config;
}

function safeReadJson(filePath, fallbackValue) {
  if (!fs.existsSync(filePath)) return fallbackValue;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`[bridge] Kunde inte läsa ${filePath}: ${error.message}`);
    return fallbackValue;
  }
}

loadDotEnv();
const cli = parseCliArgs();
const config = loadConfig(cli.mode);

function loadSessionState() {
  const initialState = {
    summary: "",
    history: [],
    limitState: {},
    providerTelemetry: {},
    checkpoints: [],
    updatedAt: null,
  };

  const state = safeReadJson(config.sessionFile, initialState);
  if (!state || typeof state !== "object") return initialState;
  if (!Array.isArray(state.history)) state.history = [];
  if (typeof state.summary !== "string") state.summary = "";
  if (!state.limitState || typeof state.limitState !== "object") state.limitState = {};
  if (!state.providerTelemetry || typeof state.providerTelemetry !== "object") {
    state.providerTelemetry = {};
  }
  if (!Array.isArray(state.checkpoints)) state.checkpoints = [];
  return state;
}

function saveSessionState() {
  const payload = JSON.stringify(
    {
      summary: runningSummary,
      history: conversationHistory,
      limitState: providerLimitState,
      providerTelemetry,
      checkpoints,
      updatedAt: new Date().toISOString(),
    },
    null,
    2
  );

  try {
    ensureParentDir(config.sessionFile);
    const tmpPath = `${config.sessionFile}.tmp`;
    fs.writeFileSync(tmpPath, payload, "utf8");
    fs.renameSync(tmpPath, config.sessionFile);
  } catch (error) {
    console.error(`[bridge] Kunde inte spara session (${config.sessionFile}): ${error.message}`);
  }
}

function clip(text, maxLen) {
  const str = String(text || "");
  return str.length <= maxLen ? str : `${str.slice(0, maxLen)}...`;
}

function refreshSummary() {
  const windowed = conversationHistory.slice(-config.summaryMaxTurns);
  if (windowed.length === 0) {
    runningSummary = "";
    return;
  }

  const lines = windowed.map((entry, idx) => {
    const userText = clip(entry.user, 120).replace(/\s+/g, " ");
    const assistantText = clip(entry.assistant, 200).replace(/\s+/g, " ");
    return `${idx + 1}. [${entry.provider}] U: ${userText} | A: ${assistantText}`;
  });

  let summary = `Recent session summary (${windowed.length} turns):\n${lines.join("\n")}`;
  if (summary.length > config.summaryMaxChars) {
    summary = summary.slice(summary.length - config.summaryMaxChars);
  }
  runningSummary = summary;
}

function buildContextPacket(newPrompt) {
  const windowSize = config.historyWindow;
  const windowedHistory =
    windowSize === 0 ? [] : conversationHistory.slice(-windowSize);

  const historyText =
    windowedHistory.length === 0
      ? "(no recent turns)"
      : windowedHistory
          .map(
            (entry, idx) =>
              `Turn ${idx + 1} [${entry.provider}]\nUser: ${entry.user}\nAssistant: ${entry.assistant}`
          )
          .join("\n\n");

  const summaryText = runningSummary || "(no summary yet)";
  return [
    "You are continuing an existing cross-provider conversation.",
    "Use the summary and recent turns as source of truth for context.",
    "",
    "Session summary:",
    summaryText,
    "",
    "Recent turns:",
    historyText,
    "",
    `Current user prompt:\n${newPrompt}`,
  ].join("\n");
}

const sessionState = loadSessionState();
const conversationHistory = sessionState.history;
let runningSummary = sessionState.summary || "";
let providerLimitState = sessionState.limitState || {};
let providerTelemetry = sessionState.providerTelemetry || {};
let checkpoints = sessionState.checkpoints || [];
if (!runningSummary && conversationHistory.length > 0) {
  refreshSummary();
}
let currentProvider = config.primaryProvider;
let runQueue = Promise.resolve();
let queueDepth = 0;
let bot = null;
let activeJob = null;
let normalRl = null;

const providers = {
  claude: {
    command: config.claudeCommand,
    args: config.claudeArgs.split(/\s+/).filter(Boolean),
  },
  codex: {
    command: config.codexCommand,
    args: config.codexArgs.split(/\s+/).filter(Boolean),
  },
};

function setProvider(providerName) {
  const provider = normalizeProvider(providerName);
  if (!providers[provider]) {
    return { ok: false, message: "Ogiltig provider. Använd 'claude' eller 'codex'." };
  }
  currentProvider = provider;
  return { ok: true, message: `Aktiv provider: ${currentProvider}` };
}

function stripAnsi(str) {
  return str.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g,
    ""
  );
}

function isQuotaOrRateLimitError(text) {
  return /(rate\W*limit|quota|insufficient|credits?|usage\W*limit|too\W*many\W*requests|token\W*limit|hit\W+your\W+limit|resets?\W+\d)/i.test(
    text || ""
  );
}

function getOtherProvider(providerName) {
  return providerName === "claude" ? "codex" : "claude";
}

function getFallbackProvider(failedProvider) {
  if (config.fallbackProvider && config.fallbackProvider !== failedProvider) {
    return config.fallbackProvider;
  }
  return getOtherProvider(failedProvider);
}

function getLimitEntry(providerName) {
  return providerLimitState[providerName] || null;
}

function setLimitEntry(providerName, errorText) {
  providerLimitState[providerName] = {
    detectedAt: new Date().toISOString(),
    errorText: clip(errorText, 300),
  };
  saveSessionState();
}

function clearLimitEntry(providerName) {
  if (!providerLimitState[providerName]) return;
  delete providerLimitState[providerName];
  saveSessionState();
}

function recordProviderOutcome(providerName, result, wasLimited) {
  if (!providerTelemetry[providerName]) {
    providerTelemetry[providerName] = { outcomes: [] };
  }
  const bucket = providerTelemetry[providerName];
  if (!Array.isArray(bucket.outcomes)) bucket.outcomes = [];

  bucket.outcomes.push({
    ts: new Date().toISOString(),
    ok: Boolean(result && result.ok),
    limited: Boolean(wasLimited),
  });

  if (bucket.outcomes.length > 40) {
    bucket.outcomes = bucket.outcomes.slice(-40);
  }
  saveSessionState();
}

function isProviderRecentlyLimited(providerName) {
  const entry = getLimitEntry(providerName);
  if (!entry || !entry.detectedAt) return false;
  const detectedTs = Date.parse(entry.detectedAt);
  if (Number.isNaN(detectedTs)) return false;
  const limitWindowMs = config.riskLimitWindowMinutes * 60 * 1000;
  return Date.now() - detectedTs <= limitWindowMs;
}

function classifyPromptRisk(userPrompt) {
  const promptChars = String(userPrompt || "").length;
  const recentTurns = conversationHistory.slice(-config.historyWindow).length;
  const summaryChars = runningSummary.length;
  const score =
    (promptChars >= config.riskHighPromptChars ? 2 : 0) +
    (recentTurns >= config.riskHighHistoryTurns ? 1 : 0) +
    (summaryChars > config.summaryMaxChars * 0.8 ? 1 : 0);
  const level = score >= 3 ? "high" : score >= 1 ? "medium" : "low";
  return { level, promptChars, recentTurns, summaryChars };
}

function preflightRoute(userPrompt, providerName) {
  if (!config.enableRiskGuard) {
    return { routeProvider: providerName, warning: null };
  }

  const risk = classifyPromptRisk(userPrompt);
  const recentlyLimited = isProviderRecentlyLimited(providerName);
  if (!recentlyLimited) {
    return { routeProvider: providerName, warning: null };
  }

  const fallbackProvider = getFallbackProvider(providerName);
  const warning = `⚠️ Riskvakt: ${providerName} nådde nyligen limit. Jobbstorlek=${risk.level} (prompt=${risk.promptChars} chars, turns=${risk.recentTurns}).`;
  const shouldRoute =
    config.enableAutoFallback &&
    config.autoRouteHighRisk &&
    risk.level !== "low" &&
    fallbackProvider !== providerName;

  if (!shouldRoute) {
    return { routeProvider: providerName, warning };
  }

  return {
    routeProvider: fallbackProvider,
    warning: `${warning} Routar till ${fallbackProvider} för att minska risk för avbrott.`,
  };
}

function formatLimitState() {
  const providersList = ["claude", "codex"];
  const rows = providersList.map((providerName) => {
    const entry = getLimitEntry(providerName);
    const est = estimateRemainingPercent(providerName);
    const estText = `~${est.percent}% kvar (${est.confidence})`;
    if (!entry) return `${providerName}: ok | ${estText}`;
    const recent = isProviderRecentlyLimited(providerName) ? "recent-limit" : "old-limit";
    return `${providerName}: ${recent} @ ${entry.detectedAt} | ${estText}`;
  });
  return `Riskstatus (estimat)\n${rows.join("\n")}`;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function estimateRemainingPercent(providerName) {
  const now = Date.now();
  let percent = 80;
  const entry = getLimitEntry(providerName);

  if (entry && entry.detectedAt) {
    const detectedTs = Date.parse(entry.detectedAt);
    if (!Number.isNaN(detectedTs)) {
      const windowMs = config.riskLimitWindowMinutes * 60 * 1000;
      const elapsed = clamp(now - detectedTs, 0, windowMs);
      const recovery = elapsed / windowMs;
      percent = Math.round(5 + recovery * 35);
    }
  }

  const outcomes = (providerTelemetry[providerName] && providerTelemetry[providerName].outcomes) || [];
  const recent = outcomes.filter((item) => {
    const ts = Date.parse(item.ts || "");
    return !Number.isNaN(ts) && now - ts <= 6 * 60 * 60 * 1000;
  });

  if (recent.length > 0) {
    const limitedCount = recent.filter((item) => item.limited).length;
    const failedCount = recent.filter((item) => !item.ok).length;
    const riskScore = (limitedCount * 2 + failedCount) / Math.max(recent.length * 2, 1);
    percent -= Math.round(riskScore * 40);

    const streak = [...recent].reverse().findIndex((item) => !item.ok);
    const successStreak = streak === -1 ? recent.length : streak;
    if (successStreak >= 3) {
      percent += 10;
    }
  }

  percent = clamp(percent, 5, 95);
  const confidence = recent.length >= 8 ? "high" : recent.length >= 3 ? "medium" : "low";
  return { percent, confidence };
}

async function notifyUser(message) {
  if (bot) {
    await bot.sendMessage(config.chatId, message);
    return;
  }

  if (message.startsWith("✅")) {
    console.log(success(message.slice(1).trim()));
    return;
  }
  if (message.startsWith("⚠️")) {
    console.log(warn(message.replace("⚠️", "").trim()));
    return;
  }
  if (message.startsWith("❌")) {
    console.log(errorLabel(message.replace("❌", "").trim()));
    return;
  }
  if (message.startsWith("[")) {
    console.log(info(message));
    return;
  }
  console.log(message);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let spawnError = null;

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("close", (code) => {
      resolve({
        ok: code === 0 && !spawnError,
        code,
        output: `${stdout}${stderr}`.trim(),
        error: spawnError ? spawnError.message : "",
      });
    });
  });
}

function parseCommitMessage(text) {
  const raw = text.slice("/commit".length).trim();
  if (!raw) return "";
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1).trim();
  }
  return raw;
}

async function commandExists(cmd) {
  if (!cmd) return false;
  const result = await runCommand("which", [cmd]);
  return result.ok;
}

async function runDoctor() {
  const rows = [];

  const gitRepo = await runCommand("git", ["rev-parse", "--is-inside-work-tree"]);
  rows.push(gitRepo.ok ? "✅ git repo: ok" : "❌ git repo: fail");

  const claudeOk = await commandExists(config.claudeCommand);
  rows.push(
    claudeOk
      ? `✅ claude command: ${config.claudeCommand}`
      : `❌ claude command missing: ${config.claudeCommand}`
  );

  const codexOk = await commandExists(config.codexCommand);
  rows.push(
    codexOk
      ? `✅ codex command: ${config.codexCommand}`
      : `❌ codex command missing: ${config.codexCommand}`
  );

  const hooksPathResult = await runCommand("git", ["config", "--get", "core.hooksPath"]);
  const hooksPath = hooksPathResult.ok ? hooksPathResult.output.trim() : "";
  const hookFile = path.join(process.cwd(), hooksPath || ".githooks", "post-push");
  const hookOk = hooksPathResult.ok && fs.existsSync(hookFile);
  rows.push(hookOk ? `✅ git hook: ${hooksPath || ".githooks"}` : "⚠️ git hook: saknas eller ej konfigurerad");

  const hasTelegramConfig = Boolean(config.botToken && config.chatId);
  rows.push(hasTelegramConfig ? "✅ telegram config: BOT_TOKEN + CHAT_ID" : "⚠️ telegram config: saknas");

  if (hasTelegramConfig) {
    const url = `https://api.telegram.org/bot${config.botToken}/getMe`;
    const netResult = await runCommand("curl", ["-sS", "--max-time", "8", url]);
    const ok = netResult.ok && /"ok"\s*:\s*true/.test(netResult.output || "");
    rows.push(ok ? "✅ telegram API: reachable" : "⚠️ telegram API: unreachable/invalid response");
  }

  return `Doctor\n${rows.join("\n")}`;
}

function formatStatus() {
  const status = [
    `Mode: ${cli.mode}`,
    `Provider: ${currentProvider}`,
    `Queue: ${queueDepth}`,
    `Active job: ${activeJob ? `#${activeJob.id} via ${activeJob.provider}` : "none"}`,
    `History turns: ${conversationHistory.length}`,
    `Session file: ${config.sessionFile}`,
  ];
  return `Bridge status\n${status.join("\n")}\n\n${formatLimitState()}`;
}

function refreshNormalPrompt() {
  if (!normalRl) return;
  const busy = Boolean(activeJob) || queueDepth > 0;
  const label = busy ? paint("1;33", "bridge*") : paint("1;34", "bridge");
  normalRl.setPrompt(label + paint("2", "> "));
}

function checkpointId() {
  const iso = new Date().toISOString().replace(/[-:TZ.]/g, "");
  return `cp-${iso.slice(0, 14)}`;
}

function sanitizeName(name) {
  return String(name || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function formatCheckpointList() {
  if (checkpoints.length === 0) return "Inga checkpoints ännu.";
  const rows = checkpoints
    .slice(-10)
    .reverse()
    .map(
      (cp) =>
        `${cp.id} | ${cp.name || "-"} | ${cp.sha.slice(0, 8)} | dirty=${cp.dirty ? "yes" : "no"} | ${cp.createdAt}`
    );
  return `Checkpoints (senaste först)\n${rows.join("\n")}`;
}

function resolveCheckpointTarget(raw) {
  const target = String(raw || "").trim();
  if (!target) return checkpoints[checkpoints.length - 1] || null;

  const byId = checkpoints.find((cp) => cp.id === target);
  if (byId) return byId;

  const byName = checkpoints
    .slice()
    .reverse()
    .find((cp) => cp.name === target);
  if (byName) return byName;

  const byShaPrefix = checkpoints
    .slice()
    .reverse()
    .find((cp) => cp.sha.startsWith(target));
  if (byShaPrefix) return byShaPrefix;

  return { id: "manual", name: "manual", sha: target, createdAt: new Date().toISOString(), dirty: false };
}

async function runPushNotifier(remote, remoteUrl) {
  const notifierScript = path.join(__dirname, "scripts", "telegram-push-notify.sh");
  if (!fs.existsSync(notifierScript)) {
    return { ok: false, skipped: true, reason: "missing_notifier_script" };
  }

  const result = await runCommand("bash", [notifierScript, remote, remoteUrl], {
    cwd: process.cwd(),
    env: { DEDUP_TTL_SECONDS: "60" },
  });

  if (!result.ok) {
    return {
      ok: false,
      skipped: false,
      reason: "notifier_failed",
      details: result.output || result.error || `exit code ${result.code}`,
    };
  }

  return { ok: true, skipped: false };
}

function runProviderWithPrompt(providerName, fullPrompt) {
  return new Promise((resolve) => {
    const provider = providers[providerName];
    console.log(`[bridge] Kör ${providerName} med kommando: ${provider.command} ${provider.args.join(" ")}`);

    const child = spawn(provider.command, provider.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    let outputBuffer = "";
    let errorBuffer = "";
    let spawnError = null;

    child.stdin.write(fullPrompt);
    child.stdin.end();

    child.stdout.on("data", (data) => {
      process.stdout.write(data);
      outputBuffer += stripAnsi(data.toString());
    });

    child.stderr.on("data", (data) => {
      process.stderr.write(data);
      errorBuffer += stripAnsi(data.toString());
    });

    child.on("error", (error) => {
      spawnError = error;
    });

    child.on("close", (code) => {
      console.log(`\n[bridge] ${providerName} avslutades med kod ${code}`);
      resolve({
        provider: providerName,
        ok: code === 0 && !spawnError,
        code,
        response: outputBuffer.trim(),
        errorText: `${errorBuffer}\n${spawnError ? spawnError.message : ""}`.trim(),
      });
    });
  });
}

async function runPrompt(userPrompt) {
  const preflight = preflightRoute(userPrompt, currentProvider);
  if (preflight.warning) {
    await notifyUser(preflight.warning);
  }

  const fullPrompt = buildContextPacket(userPrompt);
  const firstProvider = preflight.routeProvider;
  const startedAt = Date.now();
  activeJob = {
    id: startedAt,
    provider: firstProvider,
    prompt: clip(userPrompt, 80),
    startedAt,
  };
  refreshNormalPrompt();
  if (!bot) {
    console.log(info(`Arbetar: ${firstProvider} | prompt="${activeJob.prompt}"`));
  }
  let result = await runProviderWithPrompt(firstProvider, fullPrompt);
  const firstErrorText = result.errorText || result.response || "";
  const firstWasLimited = !result.ok && isQuotaOrRateLimitError(firstErrorText);

  const shouldFallback =
    config.enableAutoFallback &&
    !result.ok &&
    firstWasLimited;

  if (firstWasLimited) {
    setLimitEntry(firstProvider, firstErrorText);
  }
  recordProviderOutcome(firstProvider, result, firstWasLimited);

  if (shouldFallback) {
    const fallbackProvider = getFallbackProvider(firstProvider);
    console.log(`[bridge] Växlar till fallback-provider: ${fallbackProvider}`);
    await notifyUser(`⚠️ ${firstProvider} nådde begränsning. Växlar till ${fallbackProvider}.`);
    result = await runProviderWithPrompt(fallbackProvider, fullPrompt);
    const fallbackErrorText = result.errorText || result.response || "";
    const fallbackWasLimited = !result.ok && isQuotaOrRateLimitError(fallbackErrorText);
    if (fallbackWasLimited) {
      setLimitEntry(fallbackProvider, fallbackErrorText);
    }
    recordProviderOutcome(fallbackProvider, result, fallbackWasLimited);
  }

  if (!result.ok) {
    const errorMessage = result.errorText || `Ingen output (exit code ${result.code})`;
    await notifyUser(`❌ Körning misslyckades i ${result.provider}:\n${errorMessage.slice(0, 3500)}`);
    if (!bot) {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      console.log(errorLabel(`Klart med fel efter ${elapsed}s`));
    }
    activeJob = null;
    refreshNormalPrompt();
    return;
  }

  const response = result.response || "(tomt svar)";
  clearLimitEntry(result.provider);
  conversationHistory.push({
    provider: result.provider,
    user: userPrompt,
    assistant: response,
    ts: new Date().toISOString(),
  });
  refreshSummary();
  saveSessionState();
  const truncated = response.length > 3900 ? response.slice(-3900) : response;
  await notifyUser(`[${result.provider}]\n${truncated}`);
  if (!bot) {
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(success(`Klart på ${elapsed}s`));
  }
  activeJob = null;
  refreshNormalPrompt();
}

function enqueuePrompt(userPrompt) {
  queueDepth += 1;
  refreshNormalPrompt();
  if (!bot) {
    console.log(info(`Köad: ${clip(userPrompt, 60)} (queue=${queueDepth})`));
  }
  runQueue = runQueue
    .then(() => runPrompt(userPrompt))
    .catch((error) => {
      console.error(`[bridge] Oväntat fel: ${error.message}`);
      return notifyUser(`❌ Oväntat fel: ${error.message}`);
    })
    .finally(() => {
      queueDepth = Math.max(0, queueDepth - 1);
      refreshNormalPrompt();
    });
}

async function handleCommand(text, reply) {
  if (text === "/help") {
    await reply(normalHelpText());
    return true;
  }

  if (text === "/status") {
    await reply(formatStatus());
    return true;
  }

  if (text === "/checkpoints") {
    await reply(formatCheckpointList());
    return true;
  }

  if (text.startsWith("/checkpoint")) {
    const name = sanitizeName(text.slice("/checkpoint".length));
    const gitRepo = await runCommand("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: process.cwd(),
    });
    if (!gitRepo.ok) {
      await reply("❌ Inte i ett git-repo.");
      return true;
    }

    const shaResult = await runCommand("git", ["rev-parse", "HEAD"], { cwd: process.cwd() });
    if (!shaResult.ok) {
      await reply(`❌ Kunde inte läsa HEAD:\n${clip(shaResult.output || shaResult.error, 1000)}`);
      return true;
    }
    const sha = shaResult.output.trim();

    const dirtyResult = await runCommand("git", ["status", "--porcelain"], { cwd: process.cwd() });
    const dirty = Boolean(dirtyResult.ok && dirtyResult.output.trim());

    const cp = {
      id: checkpointId(),
      name: name || "",
      sha,
      branch: (await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: process.cwd() }))
        .output
        .trim(),
      createdAt: new Date().toISOString(),
      dirty,
    };
    checkpoints.push(cp);
    if (checkpoints.length > 100) checkpoints = checkpoints.slice(-100);
    saveSessionState();

    const dirtyNote = dirty
      ? "\n⚠️ Working tree har ocommittade ändringar (de ingår inte i checkpoint SHA)."
      : "";
    await reply(
      `✅ Checkpoint skapad.\nID: ${cp.id}\nName: ${cp.name || "-"}\nSHA: ${cp.sha.slice(0, 8)}\nBranch: ${cp.branch}${dirtyNote}`
    );
    return true;
  }

  if (text.startsWith("/rollback")) {
    const targetRaw = text.slice("/rollback".length).trim();
    const target = resolveCheckpointTarget(targetRaw);
    if (!target) {
      await reply("❌ Ingen checkpoint hittades. Skapa en med /checkpoint först.");
      return true;
    }

    const branchName = `bridge-rollback-${target.sha.slice(0, 8)}-${Date.now().toString().slice(-6)}`;
    const switchResult = await runCommand("git", ["switch", "-c", branchName, target.sha], {
      cwd: process.cwd(),
    });
    if (!switchResult.ok) {
      await reply(
        `❌ Rollback misslyckades.\n${clip(
          switchResult.output || switchResult.error || "okänt fel",
          1400
        )}\nTips: commit/stash lokala ändringar först.`
      );
      return true;
    }

    await reply(
      `✅ Rollback klar.\nNy branch: ${branchName}\nTarget: ${target.sha.slice(0, 8)} (${target.id}/${target.name || "-"})`
    );
    return true;
  }

  if (text === "/doctor") {
    await reply("🩺 Kör doctor...");
    await reply(await runDoctor());
    return true;
  }

  if (text.startsWith("/commit")) {
    const message = parseCommitMessage(text);
    if (!message) {
      await reply('❌ Usage: /commit "message"');
      return true;
    }

    const statusResult = await runCommand("git", ["status", "--porcelain"], { cwd: process.cwd() });
    if (!statusResult.ok) {
      await reply(`❌ Kunde inte läsa git status:\n${clip(statusResult.output || statusResult.error, 1200)}`);
      return true;
    }
    if (!statusResult.output.trim()) {
      await reply("⚠️ Inga ändringar att committa.");
      return true;
    }

    await reply("📝 Kör: git add -A && git commit ...");
    const addResult = await runCommand("git", ["add", "-A"], { cwd: process.cwd() });
    if (!addResult.ok) {
      await reply(`❌ git add misslyckades:\n${clip(addResult.output || addResult.error, 1400)}`);
      return true;
    }

    const commitResult = await runCommand("git", ["commit", "-m", message], { cwd: process.cwd() });
    if (!commitResult.ok) {
      await reply(`❌ git commit misslyckades:\n${clip(commitResult.output || commitResult.error, 1400)}`);
      return true;
    }

    await reply(`✅ Commit klar.\n${clip(commitResult.output, 1600)}`);
    return true;
  }

  if (text.startsWith("/push")) {
    const parts = text.trim().split(/\s+/).filter(Boolean);
    const remote = parts[1] || "origin";
    const branch = parts[2] || "";
    const args = ["push", remote];
    if (branch) args.push(branch);

    await reply(`⏫ Kör: git ${args.join(" ")}`);
    const result = await runCommand("git", args, { cwd: process.cwd() });

    if (result.ok) {
      const out = result.output ? `\n${clip(result.output, 3200)}` : "";
      await reply(`✅ Push lyckades.${out}`);

      const remoteUrlResult = await runCommand("git", ["remote", "get-url", remote], {
        cwd: process.cwd(),
      });
      const remoteUrl = remoteUrlResult.ok ? remoteUrlResult.output.split("\n")[0] : "unknown";
      const notifyResult = await runPushNotifier(remote, remoteUrl);
      if (!notifyResult.ok && !notifyResult.skipped) {
        await reply(`⚠️ Push-notis misslyckades: ${clip(notifyResult.details || "okänt fel", 500)}`);
      }
    } else {
      const out = result.output || result.error || `exit code ${result.code}`;
      await reply(`❌ Push misslyckades.\n${clip(out, 3200)}`);
    }
    return true;
  }

  if (text === "/clear") {
    conversationHistory.length = 0;
    runningSummary = "";
    saveSessionState();
    await reply("🧹 Konversationshistorik rensad.");
    return true;
  }

  if (text === "/summary") {
    const msg = runningSummary ? clip(runningSummary, 3800) : "(ingen summary ännu)";
    await reply(msg);
    return true;
  }

  if (text === "/risk") {
    await reply(formatLimitState());
    return true;
  }

  if (text === "/provider") {
    await reply(`Aktiv provider: ${currentProvider}`);
    return true;
  }

  if (text.startsWith("/provider ")) {
    const requestedProvider = normalizeProvider(text.slice("/provider ".length));
    const result = setProvider(requestedProvider);
    await reply(result.ok ? `✅ ${result.message}` : `❌ ${result.message}`);
    return true;
  }

  return false;
}

function startTelegramBridge() {
  bot = new TelegramBot(config.botToken, { polling: true });
  const rl = readline.createInterface({ input: process.stdin });

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const handled = await handleCommand(trimmed, async (message) => {
      console.log(`[bridge] ${message}`);
    });
    if (!handled) {
      enqueuePrompt(trimmed);
    }
  });

  bot.on("message", async (msg) => {
    if (String(msg.chat.id) !== String(config.chatId)) return;
    const text = (msg.text || "").trim();
    if (!text) return;

    const handled = await handleCommand(text, async (message) => {
      await bot.sendMessage(config.chatId, message);
    });
    if (!handled) {
      await bot.sendMessage(config.chatId, `✅ Kör med ${currentProvider}: ${text}`);
      enqueuePrompt(text);
    }
  });

  bot.sendMessage(
    config.chatId,
    `🚀 *claude-telegram-bridge* startad!\n\nAktiv provider: *${currentProvider}*\nSkicka text för att köra. Kommandon: /help, /status, /doctor, /checkpoint [name], /checkpoints, /rollback [target], /provider, /provider claude, /provider codex, /risk, /summary, /commit "msg", /push [remote] [branch], /clear`,
    { parse_mode: "Markdown" }
  );
}

function startNormalBridge(rawArgs) {
  const maybeProvider = normalizeProvider(rawArgs[0]);
  if (providers[maybeProvider]) {
    currentProvider = maybeProvider;
  }

  printNormalBanner(currentProvider);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  normalRl = rl;
  refreshNormalPrompt();
  rl.prompt();
  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }
    const handled = await handleCommand(trimmed, async (message) => {
      console.log(info(message));
    });
    if (!handled) {
      enqueuePrompt(trimmed);
    }
    rl.prompt();
  });
}

function startPassthroughMode(rawArgs) {
  let providerName = currentProvider;
  let providerArgs = rawArgs;
  const maybeProvider = normalizeProvider(rawArgs[0]);

  if (providers[maybeProvider]) {
    providerName = maybeProvider;
    providerArgs = rawArgs.slice(1);
  }

  const provider = providers[providerName];
  console.log(
    `[bridge] Passthrough mode startad. Provider: ${providerName}. Kommando: ${provider.command} ${providerArgs.join(
      " "
    )}`.trim()
  );

  const child = spawn(provider.command, providerArgs, {
    stdio: "inherit",
    env: process.env,
  });

  child.on("error", (error) => {
    console.error(`[bridge] Kunde inte starta ${providerName}: ${error.message}`);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      console.error(`[bridge] ${providerName} avslutades av signal ${signal}`);
      process.exit(1);
      return;
    }
    process.exit(code ?? 0);
  });
}

if (cli.mode === "normal") {
  startNormalBridge(cli.rest);
} else if (cli.mode === "passthrough") {
  startPassthroughMode(cli.rest);
} else {
  startTelegramBridge();
}
