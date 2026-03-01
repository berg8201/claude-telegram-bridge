#!/usr/bin/env node

const { spawn } = require("child_process");
const readline = require("readline");
const TelegramBot = require("node-telegram-bot-api");
const config = require("./config.json");

const bot = new TelegramBot(config.botToken, { polling: true });

let claudeProcess = null;
let pendingPrompt = null;
let timeoutHandle = null;
let waitingForTelegramReply = false;

function stripAnsi(str) {
  return str.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g,
    ""
  );
}

function isWaitingForInput(text) {
  const patterns = [
    /\?\s*$/m,
    /\(y\/n\)/i,
    /press enter/i,
    /do you want/i,
    /allow|deny|approve/i,
    /\[Y\/n\]/,
    /\[y\/N\]/,
    /continue\?/i,
    /proceed\?/i,
  ];
  return patterns.some((p) => p.test(text));
}

function clearPendingTimeout() {
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
    timeoutHandle = null;
  }
}

function sendToTelegram(message) {
  const truncated = message.length > 3000 ? message.slice(-3000) : message;
  bot.sendMessage(
    config.chatId,
    `🤖 *Claude Code väntar på svar:*\n\n\`\`\`\n${truncated}\n\`\`\`\n\nSvara med ditt svar (t.ex. \`y\`, \`n\`, eller text).`,
    { parse_mode: "Markdown" }
  );
}

function feedInputToClaude(input) {
  if (claudeProcess && claudeProcess.stdin.writable) {
    claudeProcess.stdin.write(input + "\n");
    console.log(`[bridge] Skickade input till Claude: ${input}`);
  }
  waitingForTelegramReply = false;
  pendingPrompt = null;
}

bot.on("message", (msg) => {
  if (String(msg.chat.id) !== String(config.chatId)) return;
  const text = msg.text || "";

  if (!waitingForTelegramReply) {
    if (text.startsWith("/run ")) {
      const cmd = text.slice(5);
      feedInputToClaude(cmd);
      bot.sendMessage(config.chatId, `✅ Skickade: \`${cmd}\``, { parse_mode: "Markdown" });
    } else {
      bot.sendMessage(
        config.chatId,
        "ℹ️ Inget väntande svar från Claude just nu.\n\nAnvänd `/run <text>` för att skicka input.",
        { parse_mode: "Markdown" }
      );
    }
    return;
  }

  bot.sendMessage(config.chatId, `✅ Skickade till Claude: \`${text}\``, { parse_mode: "Markdown" });
  feedInputToClaude(text);
});

function startClaude(args) {
  console.log(`[bridge] Startar Claude Code med args: ${args.join(" ")}`);

  claudeProcess = spawn("claude", args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  let outputBuffer = "";

  claudeProcess.stdout.on("data", (data) => {
    const text = stripAnsi(data.toString());
    process.stdout.write(data);
    outputBuffer += text;

    if (isWaitingForInput(text)) {
      pendingPrompt = outputBuffer.trim();
      outputBuffer = "";
      clearPendingTimeout();

      timeoutHandle = setTimeout(() => {
        if (pendingPrompt) {
          console.log(`\n[bridge] Ingen lokal input på ${config.timeoutSeconds}s — skickar till Telegram...`);
          waitingForTelegramReply = true;
          sendToTelegram(pendingPrompt);
        }
      }, config.timeoutSeconds * 1000);
    } else {
      outputBuffer = "";
    }
  });

  claudeProcess.stderr.on("data", (data) => {
    process.stderr.write(data);
  });

  claudeProcess.on("close", (code) => {
    clearPendingTimeout();
    console.log(`\n[bridge] Claude Code avslutades med kod ${code}`);
    bot.sendMessage(
      config.chatId,
      `🏁 *Claude Code är klar!*\nAvslutade med kod \`${code}\`.`,
      { parse_mode: "Markdown" }
    );
    setTimeout(() => process.exit(code), 1000);
  });

  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    clearPendingTimeout();
    waitingForTelegramReply = false;
    pendingPrompt = null;
    feedInputToClaude(line);
  });
}

bot.sendMessage(
  config.chatId,
  `🚀 *claude-telegram-bridge* startad!\n\nFrågor från Claude Code vidarebefordras hit om du inte svarar inom *${config.timeoutSeconds} sekunder*.`,
  { parse_mode: "Markdown" }
);

const args = process.argv.slice(2);
startClaude(args);
