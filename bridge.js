#!/usr/bin/env node

const { spawn } = require("child_process");
const fs = require("fs");
const readline = require("readline");
const TelegramBot = require("node-telegram-bot-api");

function loadDotEnv() {
  const envPath = "./.env";
  if (!fs.existsSync(envPath)) return;

  let content = "";
  try {
    content = fs.readFileSync(envPath, "utf8");
  } catch (error) {
    console.error(`[bridge] Kunde inte läsa .env: ${error.message}`);
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

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function loadConfig() {
  let fileConfig = {};

  if (fs.existsSync("./config.json")) {
    try {
      fileConfig = require("./config.json");
    } catch (error) {
      console.error(`[bridge] Kunde inte läsa config.json: ${error.message}`);
      process.exit(1);
    }
  }

  const config = {
    botToken: process.env.BOT_TOKEN || fileConfig.botToken,
    chatId: process.env.CHAT_ID || fileConfig.chatId,
    timeoutSeconds: Number(process.env.TIMEOUT_SECONDS || fileConfig.timeoutSeconds || 30),
  };

  if (!config.botToken) {
    console.error("[bridge] Saknar bot-token. Sätt BOT_TOKEN eller config.json.botToken.");
    process.exit(1);
  }

  if (!config.chatId) {
    console.error("[bridge] Saknar chat-id. Sätt CHAT_ID eller config.json.chatId.");
    process.exit(1);
  }

  return config;
}

loadDotEnv();
const config = loadConfig();

const bot = new TelegramBot(config.botToken, { polling: true });

const conversationHistory = [];

function buildPromptWithHistory(newPrompt) {
  if (conversationHistory.length === 0) return newPrompt;
  const historyText = conversationHistory
    .map((entry) => `User: ${entry.user}\nAssistant: ${entry.assistant}`)
    .join("\n\n");
  return `Previous conversation:\n${historyText}\n\nUser: ${newPrompt}`;
}

function stripAnsi(str) {
  return str.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g,
    ""
  );
}

function runClaudeWithPrompt(userPrompt) {
  console.log(`[bridge] Kör Claude med prompt: ${userPrompt}`);

  const fullPrompt = buildPromptWithHistory(userPrompt);

  const claudeProcess = spawn("claude", ["--print"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  let outputBuffer = "";

  claudeProcess.stdin.write(fullPrompt);
  claudeProcess.stdin.end();

  claudeProcess.stdout.on("data", (data) => {
    process.stdout.write(data);
    outputBuffer += stripAnsi(data.toString());
  });

  claudeProcess.stderr.on("data", (data) => {
    process.stderr.write(data);
  });

  claudeProcess.on("close", (code) => {
    console.log(`\n[bridge] Claude Code avslutades med kod ${code}`);
    const response = outputBuffer.trim();
    if (response) {
      conversationHistory.push({ user: userPrompt, assistant: response });
      const truncated = response.length > 4000 ? response.slice(-4000) : response;
      bot.sendMessage(config.chatId, truncated);
    }
  });
}

function startClaude() {
  const rl = readline.createInterface({ input: process.stdin });

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed) {
      runClaudeWithPrompt(trimmed);
    }
  });

  bot.on("message", (msg) => {
    if (String(msg.chat.id) !== String(config.chatId)) return;
    const text = (msg.text || "").trim();
    if (!text) return;
    if (text === "/clear") {
      conversationHistory.length = 0;
      bot.sendMessage(config.chatId, "🧹 Konversationshistorik rensad.");
      return;
    }
    bot.sendMessage(config.chatId, `✅ Kör: \`${text}\``, { parse_mode: "Markdown" });
    runClaudeWithPrompt(text);
  });
}

bot.sendMessage(
  config.chatId,
  `🚀 *claude-telegram-bridge* startad!\n\nSkicka ett meddelande hit eller skriv i terminalen för att köra Claude Code.`,
  { parse_mode: "Markdown" }
);

startClaude();
