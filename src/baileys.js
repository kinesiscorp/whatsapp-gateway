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

const DEFAULT_COUNTRY_CODE = "55";

/**
 * Celular BR sem o 9: 55 + DDD(2) + 8 dígitos (12 no total) → insere 9 após o DDD.
 */
export function insertBrazilMobileNine(e164Digits) {
  if (!e164Digits.startsWith(DEFAULT_COUNTRY_CODE) || e164Digits.length !== 12) {
    return e164Digits;
  }
  const ddd = e164Digits.slice(2, 4);
  const local = e164Digits.slice(4);
  if (local.length !== 8) return e164Digits;
  return `${DEFAULT_COUNTRY_CODE}${ddd}9${local}`;
}

/**
 * Apenas dígitos; se faltar DDI do Brasil, prefixa 55 (igual ao backend).
 * Aceita: "5517936309413", "+5517936309413", "17936309413", "(17) 93630-9413"
 */
export function normalizeWhatsAppNumber(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  let n = digits;
  if (!n.startsWith(DEFAULT_COUNTRY_CODE) && n.length >= 10) {
    n = `${DEFAULT_COUNTRY_CODE}${n}`;
  }
  if (n.startsWith(DEFAULT_COUNTRY_CODE) && n.length >= 12) {
    n = insertBrazilMobileNine(n);
  }
  return n;
}

/** Variantes E.164 para consultar onWhatsApp (com/sem 9 em celular BR). */
export function whatsAppNumberCandidates(normalized) {
  const out = [normalized];
  if (!normalized.startsWith(DEFAULT_COUNTRY_CODE)) return out;
  const rest = normalized.slice(2);
  if (rest.length === 11 && rest[2] === "9") {
    out.push(`${DEFAULT_COUNTRY_CODE}${rest.slice(0, 2)}${rest.slice(3)}`);
  }
  if (rest.length === 10) {
    out.push(insertBrazilMobileNine(normalized));
  }
  return [...new Set(out)];
}

/**
 * Resolve JID canônico via WhatsApp (evita enviar para @s.whatsapp.net inválido).
 */
export async function resolveWhatsAppJid(sock, normalized) {
  const candidates = whatsAppNumberCandidates(normalized);
  for (const num of candidates) {
    const jid = `${num}@s.whatsapp.net`;
    const results = await sock.onWhatsApp(jid);
    const hit = results?.[0];
    if (hit?.exists) {
      return { jid: hit.jid || jid, digits: num };
    }
  }
  return null;
}

export function isWhatsAppReady(sock) {
  return Boolean(sock?.user?.id);
}

/**
 * Envia mensagem de texto para um número.
 * Número: preferir "5517936309413" (DDI 55 + DDD + número, só dígitos).
 */
export async function sendMessage(sock, number, text) {
  const normalized = normalizeWhatsAppNumber(number);
  if (!normalized) {
    throw new Error("invalid_number");
  }
  if (!isWhatsAppReady(sock)) {
    throw new Error("whatsapp_not_ready");
  }

  const resolved = await resolveWhatsAppJid(sock, normalized);
  if (!resolved) {
    throw new Error("number_not_on_whatsapp");
  }

  const sent = await sock.sendMessage(resolved.jid, { text });
  const msgId = sent?.key?.id || "";
  console.log(
    `📤 Enviado para ${resolved.digits} (jid ${resolved.jid}, id ${msgId}): "${text}"`
  );
  return { jid: resolved.jid, digits: resolved.digits, messageId: msgId };
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
