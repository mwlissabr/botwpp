import express from 'express';
import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import { Sticker, StickerTypes } from 'wa-sticker-formatter';
import pino from 'pino';
import fs from 'fs';

// Previne que erros de criptografia da libsignal derrubem o processo
process.on('uncaughtException', (err) => {
  if (err?.message?.includes('Bad MAC')) return;
  console.error('Erro não tratado:', err);
});

process.on('unhandledRejection', (reason) => {
  if (reason?.message?.includes('Bad MAC')) return;
  console.error('Rejeição não tratada:', reason);
});

const app = express();
const PORT = process.env.PORT || 3000;

let currentQR = null;

app.get('/qr', async (req, res) => {
  if (!currentQR) {
    return res.send(`
      <html>
        <body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background-color:#f4f4f9;">
          <h2>QR Code indisponível!</h2>
          <p>O bot já está conectado ou o QR Code ainda está sendo gerado.</p>
        </body>
      </html>
    `);
  }

  try {
    const qrImageUrl = await QRCode.toDataURL(currentQR);
    res.send(`
      <html>
        <body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background-color:#f4f4f9;">
          <h2 style="color:#333;">Escaneie o QR Code com o WhatsApp do seu celular</h2>
          <div style="padding:20px;background:#fff;border-radius:10px;box-shadow:0 4px 8px rgba(0,0,0,0.1);">
            <img src="${qrImageUrl}" alt="QR Code" style="width:300px;height:300px;" />
          </div>
          <p style="color:#666;margin-top:15px;">Atualize esta página se o QR Code expirar.</p>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send('Erro ao converter QR Code para imagem');
  }
});

app.get('/', (req, res) => res.send('Bot rodando perfeitamente!'));
app.listen(PORT, '0.0.0.0', () => console.log(`Servidor HTTP ativo na porta ${PORT}`));

const logger = pino({ level: 'silent' });
const KEYWORD = '@bot';

const STICKER_OPTIONS = {
  pack: 'Figurinhas',
  author: 'Meu Bot',
  type: StickerTypes.FULL,
  quality: 70,
};

async function startBot() {
  const authPath = process.env.WA_AUTH_PATH || './auth_info';
  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    retryRequestDelayMs: 250,
    getMessage: async () => ({ conversation: '' }),
  });

  // Salva as credenciais aguardando a gravação em disco
  sock.ev.on('creds.update', async () => {
    await saveCreds();
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = qr;
      console.log('📌 Novo QR Code gerado na rota /qr');
      qrcodeTerminal.generate(qr, { small: true });
    }

    if (connection === 'close') {
      currentQR = null;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;

      console.log(`Conexão fechada. Código: ${statusCode || 'Desconhecido'}`);

      if (isLoggedOut) {
        console.log('❌ Sessão expirada. Apagando credenciais...');
        if (fs.existsSync(authPath)) {
          fs.rmSync(authPath, { recursive: true, force: true });
        }
        setTimeout(startBot, 2000);
      } else {
        console.log('⚡ Reconectando...');
        setTimeout(startBot, 3000);
      }
    } else if (connection === 'open') {
      currentQR = null;
      console.log('✅ Bot conectado e pronto!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        if (!msg.message) continue;

        const jid = msg.key.remoteJid;
        const imageMessage =
          msg.message.imageMessage ||
          msg.message.viewOnceMessageV2?.message?.imageMessage;

        if (!imageMessage) continue;

        const caption = (imageMessage.caption || '').toLowerCase();
        if (!caption.includes(KEYWORD)) continue;

        console.log(`📩 Processando imagem de ${jid}...`);

        const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger });
        const sticker = new Sticker(buffer, STICKER_OPTIONS);
        const stickerBuffer = await sticker.toBuffer();

        await sock.sendMessage(jid, { sticker: stickerBuffer });
        console.log(`✅ Figurinha enviada para ${jid}`);
      } catch (err) {
        console.error('Erro ao processar figurinha:', err.message);
      }
    }
  });
}

startBot();