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

  // Loga no console
  const origin = isGroup ? "[GRUPO]" : "[PRIVADO]";
  console.log(`📩 ${origin} ${name} (${sender}): ${text}`);

  if (!text) return;

  // Tenta executar como comando
  await handleCommand(sock, msg, text);
}

startSendHttpServer();
connectToWhatsApp(onMessage);
