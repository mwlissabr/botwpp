const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: process.env.WWEBJS_AUTH_PATH || '.wwebjs_auth',
  }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  },
});

client.on('qr', (qr) => {
  console.log('Escaneie o QR Code abaixo com o WhatsApp do seu celular:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ Bot conectado e pronto para transformar imagens em figurinhas!');
});

client.on('auth_failure', (msg) => {
  console.error('❌ Falha na autenticação:', msg);
});

client.on('disconnected', (reason) => {
  console.log('⚠️ Cliente desconectado:', reason);
});

const STICKER_CONFIG = {
  sendMediaAsSticker: true,
  stickerAuthor: 'Meu Bot',
  stickerName: 'Figurinhas',
  stickerCategories: ['🤖'],
};

client.on('message', async (msg) => {
  try {
    if (!msg.hasMedia) return;

    const attachmentTypes = ['image', 'video'];
    const messageType = msg.type; // 'image', 'video', 'sticker', etc.

    if (!attachmentTypes.includes(messageType)) return;

    const caption = (msg.body || '').toLowerCase();
    const keywords = ['@Bot'];
    if (!keywords.some((k) => caption.includes(k))) return;

    console.log(`📩 Mídia recebida de ${msg.from}, convertendo em figurinha...`);

    const media = await msg.downloadMedia();
    if (!media) {
      await msg.reply('❌ Não consegui baixar essa mídia, tenta enviar de novo.');
      return;
    }

    await client.sendMessage(msg.from, media, STICKER_CONFIG);
    console.log(`✅ Figurinha enviada para ${msg.from}`);
  } catch (err) {
    console.error('Erro ao criar figurinha:', err);
    try {
      await msg.reply('❌ Ocorreu um erro ao criar a figurinha. Tenta novamente.');
    } catch (_) {}
  }
});

client.initialize();
