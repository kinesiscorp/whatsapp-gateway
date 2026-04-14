# 📱 WhatsApp Gateway — Baileys

Gateway simples e funcional de WhatsApp usando Node.js e [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys).

Conecta ao WhatsApp via QR Code, salva a sessão, reconecta automaticamente e permite enviar/receber mensagens com sistema de comandos.

---

## ⚡ Funcionalidades

- ✅ Conexão via **QR Code** no terminal
- ✅ **Auto login** — sessão salva localmente
- ✅ **Reconexão automática** se a conexão cair
- ✅ Enviar e receber mensagens de texto
- ✅ Sistema de **comandos** extensível (`!ping`, `!menu`, `!hora`)
- ✅ Configuração via `.env`

---

## 📁 Estrutura

```
whatsapp-gateway-baileys/
├── src/
│   ├── index.js        # Ponto de entrada — inicia o bot
│   ├── baileys.js      # Conexão, QR Code, envio/recebimento
│   ├── http-send.js    # Servidor HTTP POST /send
│   └── commands.js     # Comandos do bot
├── sessions/           # Sessão salva (gerada automaticamente)
├── .env                # Configurações do bot
├── .env.example        # Template do .env
└── package.json
```

---

## 🚀 Como Usar

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar (opcional)

Copie o template e ajuste se quiser:

```bash
cp .env.example .env
```

Variáveis disponíveis:

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `BOT_PREFIX` | `!` | Prefixo dos comandos |
| `BOT_NAME` | `WhatsApp Gateway` | Nome no terminal |
| `TIMEZONE` | `America/Sao_Paulo` | Fuso horário |
| `HTTP_PORT` | *(vazio)* | Porta do servidor HTTP; se definido, habilita `POST /send` |
| `API_SECRET` | *(vazio)* | Se definido, exige `Authorization: Bearer …` ou `X-API-Key` |

### 3. Iniciar o bot

```bash
npm start
```

### 4. Escanear o QR Code

1. O QR Code aparece no terminal
2. Abra o **WhatsApp** no celular
3. Vá em **Dispositivos Conectados → Conectar dispositivo**
4. Escaneie o QR Code
5. Pronto! ✅

> Na próxima vez que rodar, o bot reconecta sozinho sem precisar escanear novamente.

---

## 🤖 Comandos

| Comando | Resposta |
|---------|----------|
| `!ping` | 🏓 pong! — verifica se está online |
| `!menu` | 📋 lista todos os comandos |
| `!hora` | 🕐 mostra data/hora atual |

### Adicionando novos comandos

Edite `src/commands.js` e adicione ao objeto `commands`:

```javascript
"!oi": {
  desc: "Manda um oi de volta",
  run: async (sock, msg) => {
    await replyMessage(sock, msg, "Olá! 👋");
  },
},
```

---

## 📤 Enviar mensagens via código

```javascript
import { connectToWhatsApp, sendMessage } from "./src/baileys.js";

const sock = await connectToWhatsApp();

// Enviar mensagem para um número (com código do país)
await sendMessage(sock, "5511999999999", "Olá do Gateway! 🚀");
```

---

## 🌐 Enviar por HTTP (`POST /send`)

1. No `.env`, defina por exemplo `HTTP_PORT=3000` (reinicie o `npm start`).
2. Conecte o WhatsApp pelo QR Code; enquanto não estiver **conectado**, o endpoint responde `503`.
3. Envie JSON com número (só dígitos, com DDI) e texto:

```bash
curl -sS -X POST http://127.0.0.1:3000/send \
  -H "Content-Type: application/json" \
  -d '{"number":"5511999999999","text":"Olá via HTTP"}'
```

Com `API_SECRET` definido:

```bash
curl -sS -X POST http://127.0.0.1:3000/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SEU_TOKEN" \
  -d '{"number":"5511999999999","text":"Olá"}'
```

Respostas: `200` `{ "ok": true }`; `400` JSON inválido ou campos faltando; `401` token errado; `503` WhatsApp desconectado; `500` falha ao enviar.

---

## 📦 Tecnologias

- [Node.js](https://nodejs.org/) (≥ 20)
- [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) — conexão com WhatsApp Web
- [qrcode-terminal](https://www.npmjs.com/package/qrcode-terminal) — QR Code no terminal
- [dotenv](https://www.npmjs.com/package/dotenv) — variáveis de ambiente

---

## 📝 Licença

MIT
