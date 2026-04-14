import { replyMessage } from "./baileys.js";

// Comandos disponíveis — adicione novos aqui
const commands = {
  "!ping": {
    desc: "Verifica se o bot está online",
    run: async (sock, msg) => {
      await replyMessage(sock, msg, "🏓 *pong!*\nBot funcionando!");
    },
  },

  "!menu": {
    desc: "Mostra os comandos",
    run: async (sock, msg) => {
      let text = "📋 *COMANDOS*\n\n";
      for (const [cmd, { desc }] of Object.entries(commands)) {
        text += `▸ *${cmd}* — ${desc}\n`;
      }
      await replyMessage(sock, msg, text);
    },
  },

  "!hora": {
    desc: "Mostra a hora atual",
    run: async (sock, msg) => {
      const tz = process.env.TIMEZONE || "America/Sao_Paulo";
      const now = new Date().toLocaleString("pt-BR", { timeZone: tz });
      await replyMessage(sock, msg, `🕐 *${now}*`);
    },
  },
};

/**
 * Tenta executar um comando. Retorna true se encontrou.
 */
export async function handleCommand(sock, msg, text) {
  const prefix = process.env.BOT_PREFIX || "!";
  const cmd = text.trim().split(" ")[0].toLowerCase();

  // Só processa se começar com o prefixo
  if (!cmd.startsWith(prefix)) return false;

  if (commands[cmd]) {
    console.log(`⚡ Comando: ${cmd}`);
    await commands[cmd].run(sock, msg);
    return true;
  }

  return false;
}
