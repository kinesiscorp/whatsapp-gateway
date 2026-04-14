import http from "http";
import { getActiveSock, sendMessage } from "./baileys.js";

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

/**
 * POST /send — corpo JSON: { "number": "5511999999999", "text": "..." }
 * Se API_SECRET estiver definido: Authorization: Bearer <secret> ou header X-API-Key.
 */
export function startSendHttpServer() {
  const port = Number(process.env.HTTP_PORT || 0);
  if (!port) {
    console.log("ℹ️  HTTP desligado (defina HTTP_PORT para habilitar POST /send)");
    return;
  }

  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/send") {
      json(res, 404, { ok: false, error: "not_found" });
      return;
    }

    const secret = process.env.API_SECRET;
    if (secret) {
      const auth = req.headers.authorization || "";
      const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      const key = (req.headers["x-api-key"] || "").toString().trim();
      if (bearer !== secret && key !== secret) {
        json(res, 401, { ok: false, error: "unauthorized" });
        return;
      }
    }

    let body;
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { ok: false, error: "invalid_json" });
      return;
    }

    const number = body.number;
    const text = body.text;
    if (typeof number !== "string" || typeof text !== "string" || !number.trim() || !text.trim()) {
      json(res, 400, { ok: false, error: "number_and_text_required" });
      return;
    }

    const sock = getActiveSock();
    if (!sock) {
      json(res, 503, { ok: false, error: "whatsapp_not_connected" });
      return;
    }

    try {
      await sendMessage(sock, number.trim(), text.trim());
      json(res, 200, { ok: true });
    } catch (e) {
      console.error("POST /send:", e);
      json(res, 500, {
        ok: false,
        error: "send_failed",
        message: String(e?.message || e),
      });
    }
  });

  server.listen(port, () => {
    console.log(`🌐 HTTP: POST http://127.0.0.1:${port}/send`);
    if (!process.env.API_SECRET) {
      console.warn("⚠️  API_SECRET vazio — qualquer cliente na rede pode chamar /send");
    }
  });
}
