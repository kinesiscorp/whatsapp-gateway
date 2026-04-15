import "dotenv/config";
import { connectToWhatsApp, getMessageInfo } from "./baileys.js";
import { handleCommand } from "./commands.js";
import { startSendHttpServer } from "./http-send.js";

const name = process.env.BOT_NAME || "WhatsApp Gateway";

console.log("==================================================");
console.log(`  🚀 ${name}`);
console.log("==================================================\n");

// Callback chamado a cada mensagem recebida
async function onMessage(sock, msg) {
  const { sender, name, text, isGroup } = getMessageInfo(msg);
  const remoteJid = msg?.key?.remoteJid || "";
  const isStatus = remoteJid === "status@broadcast";
  const isBroadcast = remoteJid.endsWith("@broadcast");

  // Loga no console
  const origin = isGroup ? "[GRUPO]" : "[PRIVADO]";
  console.log(`📩 ${origin} ${name} (${sender}): ${text}`);

  // Ignora status, grupos e broadcasts
  if (isGroup || isStatus || isBroadcast) return;
  if (!text) return;

  // Tenta executar como comando
  const handled = await handleCommand(sock, msg, text);

  // Auto-reply em DM (se habilitado) quando não for comando
  const autoReplyEnabled = (process.env.AUTO_REPLY || "").toLowerCase() === "true";
  if (autoReplyEnabled && !handled) {
    const replyText = process.env.AUTO_REPLY_TEXT || "Olá! Como posso ajudar?";
    const { replyMessage } = await import("./baileys.js");
    await replyMessage(sock, msg, replyText);
  }
}

startSendHttpServer();
connectToWhatsApp(onMessage);
