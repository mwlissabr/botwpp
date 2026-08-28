import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import { Sticker, StickerTypes } from 'wa-sticker-formatter';
import pino from 'pino';
import fs from 'fs';

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
  
  // Busca a versão atual do WhatsApp Web para evitar rejeição na conexão
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('Escaneie o QR Code abaixo com o WhatsApp do seu celular:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;

      console.log(`Conexão fechada. Código de status: ${statusCode || 'Desconhecido'}`);

      if (isLoggedOut) {
        console.log('❌ Sessão expirada ou deslogada. Limpando credenciais...');
        if (fs.existsSync(authPath)) {
          fs.rmSync(authPath, { recursive: true, force: true });
        }
        console.log('Reiniciando para gerar novo QR Code...');
        setTimeout(startBot, 2000);
      } else {
        console.log('⚡ Reconectando em 3 segundos...');
        setTimeout(startBot, 3000);
      }
    } else if (connection === 'open') {
      console.log('✅ Bot conectado e pronto para transformar imagens em figurinhas!');
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

        console.log(`📩 Imagem recebida de ${jid}, convertendo em figurinha...`);

        const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger });
        const sticker = new Sticker(buffer, STICKER_OPTIONS);
        const stickerBuffer = await sticker.toBuffer();

        await sock.sendMessage(jid, { sticker: stickerBuffer });
        console.log(`✅ Figurinha enviada para ${jid}`);
      } catch (err) {
        console.error('Erro ao criar figurinha:', err);
      }
    }
  });
}

startBot();