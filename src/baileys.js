import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  proto,
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

/** Cache mínimo de mensagens para o callback getMessage (exigido pelo Baileys 6.x). */
const messageCache = new Map();

/**
 * Mapeamento LID (@lid) → JID de telefone (@s.whatsapp.net).
 * Populado via contacts.upsert quando o WhatsApp sincroniza contatos.
 * Necessário porque em clientes novos o remoteJid chega como @lid,
 * mas o sendMessage precisa do JID de telefone para entrega real.
 */
const lidToPhoneJid = new Map();

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
    // Necessário para entrega confiável de mensagens no Baileys 6.x
    getMessage: async (key) => {
      const cached = messageCache.get(key.id ?? "");
      if (cached) return cached;
      return proto.Message.fromObject({});
    },
    // Não sincroniza histórico completo (mais rápido e evita problemas de entrega)
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  // Salva credenciais quando atualizadas
  sock.ev.on("creds.update", saveCreds);

  // Constrói mapa LID → JID de telefone para entrega de mensagens
  sock.ev.on("contacts.upsert", (contacts) => {
    for (const c of contacts) {
      if (!c.id || !c.lid) continue;
      const lid = c.lid.includes("@") ? c.lid : `${c.lid}@lid`;
      const phone = c.id.includes("@") ? c.id : `${c.id}@s.whatsapp.net`;
      if (!phone.endsWith("@lid")) {
        lidToPhoneJid.set(lid, phone);
      }
    }
    console.log(`[contacts] ${lidToPhoneJid.size} LID(s) mapeado(s)`);
  });

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
    for (const msg of messages) {
      if (msg.message && msg.key.id) {
        messageCache.set(msg.key.id, msg.message);
        if (messageCache.size > 500) {
          const firstKey = messageCache.keys().next().value;
          messageCache.delete(firstKey);
        }
      }
    }

    if (type !== "notify") return;

    for (const msg of messages) {
      if (msg.key.fromMe || !msg.message) continue;
      if (onMessage) {
        Promise.resolve(onMessage(sock, msg)).catch((err) => {
          console.error("❌ Erro ao processar mensagem:", err?.message || err);
        });
      }
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
 * Resolve @lid → @s.whatsapp.net para que a mensagem seja entregue.
 *
 * Ordem de tentativa:
 *  1. Cache local (populado via contacts.upsert)
 *  2. Lookup remoto via sock.onWhatsApp (USyncQuery – busca no servidor WA)
 *  3. Fallback: retorna o próprio LID (último recurso)
 */
async function resolveReplyJid(sock, rawJid) {
  if (!rawJid?.endsWith("@lid")) return rawJid;

  const cached = lidToPhoneJid.get(rawJid);
  if (cached) {
    console.log(`[lid] cache: ${rawJid} → ${cached}`);
    return cached;
  }

  try {
    const results = await sock.onWhatsApp(rawJid);
    const hit = results?.[0];
    if (hit?.exists && hit.jid) {
      const resolved = hit.jid.endsWith("@lid") ? rawJid : hit.jid;
      if (!resolved.endsWith("@lid")) {
        lidToPhoneJid.set(rawJid, resolved);
        console.log(`[lid] resolvido: ${rawJid} → ${resolved}`);
        return resolved;
      }
    }
  } catch (err) {
    console.warn(`[lid] onWhatsApp falhou para ${rawJid}:`, err?.message || err);
  }

  console.warn(`[lid] sem resolução para ${rawJid} — enviando direto (pode falhar)`);
  return rawJid;
}

/**
 * Responde uma mensagem (com quote).
 */
export async function replyMessage(sock, msg, text) {
  const rawJid = msg.key.remoteJid;
  const jid = await resolveReplyJid(sock, rawJid);
  console.log(`💬 replyMessage → jid=${jid} textLen=${text.length}`);
  try {
    const sent = await sock.sendMessage(jid, { text }, { quoted: msg });
    console.log(`💬 replyMessage ok → msgId=${sent?.key?.id || "-"}`);
  } catch (err) {
    console.error(`💬 replyMessage erro → jid=${jid}:`, err?.message || err);
    throw err;
  }
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
