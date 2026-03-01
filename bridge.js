#!/usr/bin/env node

const { spawn } = require("child_process");
const readline = require("readline");
const TelegramBot = require("node-telegram-bot-api");
const config = require("./config.json");

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
