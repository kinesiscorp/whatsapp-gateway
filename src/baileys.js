import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import pino from "pino";
import path from "path";
import { fileURLToPath } from "url";

// Resolve __dirname em ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, "..", "sessions");

/** Socket com sessão aberta (usado pelo HTTP /send e reconexões). */
let activeSock = null;

export function getActiveSock() {
  return activeSock;
}

/**
 * Conecta ao WhatsApp e retorna o socket.
 * - Mostra QR Code no terminal
 * - Salva sessão para auto login
 * - Reconecta automaticamente se cair
 */
export async function connectToWhatsApp(onMessage) {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  console.log(`📱 Usando WA Web v${version.join(".")}`);

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
  });

  // Salva credenciais quando atualizadas
  sock.ev.on("creds.update", saveCreds);

  // Gerencia conexão, QR e reconexão
  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Mostra QR Code no terminal
    if (qr) {
      console.log("\n📸 Escaneie o QR Code abaixo:\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      activeSock = null;
      const statusCode = lastDisconnect?.error?.output?.statusCode;

      if (statusCode === DisconnectReason.loggedOut) {
        console.log("❌ Deslogado. Apague a pasta 'sessions/' e rode novamente.");
        return;
      }

      console.log("🔄 Reconectando em 3s...");
      setTimeout(() => connectToWhatsApp(onMessage), 3000);
    }

    if (connection === "open") {
      activeSock = sock;
      console.log("✅ Conectado ao WhatsApp!");
    }
  });

  // Escuta mensagens recebidas
  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (msg.key.fromMe || !msg.message) continue;
      if (onMessage) onMessage(sock, msg);
    }
  });

  return sock;
}

/**
 * Envia mensagem de texto para um número.
 * Número no formato: "5511999999999"
 */
export async function sendMessage(sock, number, text) {
  const jid = number.replace(/\D/g, "") + "@s.whatsapp.net";
  await sock.sendMessage(jid, { text });
  console.log(`📤 Enviado para ${number}: "${text}"`);
}

/**
 * Responde uma mensagem (com quote).
 */
export async function replyMessage(sock, msg, text) {
  await sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });
}

/**
 * Extrai informações de uma mensagem.
 */
export function getMessageInfo(msg) {
  const jid = msg.key.remoteJid;
  const isGroup = jid.endsWith("@g.us");

  return {
    sender: (isGroup ? msg.key.participant : jid)?.replace("@s.whatsapp.net", ""),
    name: msg.pushName || "Desconhecido",
    text:
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      "",
    isGroup,
  };
}
