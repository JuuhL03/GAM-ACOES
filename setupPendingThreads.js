require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const fs   = require('fs');
const path = require('path');

// ── Coloque aqui os IDs das mensagens originais pendentes ─────────────────────
const PENDENTES = [
  '123456789012345678',
  '234567890123456789',
  // adicione quantos precisar...
];
// ─────────────────────────────────────────────────────────────────────────────

const JSON_PATH = path.join(__dirname, 'pendingThreads.json');

function loadJson() {
  if (fs.existsSync(JSON_PATH)) {
    try { return JSON.parse(fs.readFileSync(JSON_PATH, 'utf8')); } catch { }
  }
  return {};
}

function saveJson(data) {
  fs.writeFileSync(JSON_PATH, JSON.stringify(data, null, 2));
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', async () => {
  console.log(`✅ Logado como ${client.user.tag}`);

  const jsonData = loadJson();
  let salvos = 0;

  const canal = await client.channels.fetch(process.env.THREAD_CHANNEL_ID);

  for (const originalMsgId of PENDENTES) {
    try {
      const msg = await canal.messages.fetch(originalMsgId);

      let threadId;

      if (msg.thread) {
        threadId = msg.thread.id;
        console.log(`♻️  Thread já existia: ${threadId}`);
      } else {
        const thread = await msg.startThread({
          name: `Avaliação — ${msg.member?.displayName ?? msg.author.username}`,
          autoArchiveDuration: 1440,
        });
        threadId = thread.id;
        console.log(`✅ Thread criada: ${threadId}`);
      }

      const thread = await client.channels.fetch(threadId);
      const botao  = new ButtonBuilder()
        .setCustomId('iniciar_avaliacao')
        .setLabel('📋  Iniciar Avaliação')
        .setStyle(ButtonStyle.Primary);

      const setupMsg = await thread.send({
        content: '## 📋 Avaliação de Piloto\nClique no botão abaixo para iniciar uma nova avaliação.',
        components: [new ActionRowBuilder().addComponents(botao)],
      });

      jsonData[threadId] = { setupMsgId: setupMsg.id, originalMsgId };
      console.log(`💾 Salvo: thread ${threadId} → msg original ${originalMsgId}`);
      salvos++;

    } catch (err) {
      console.error(`❌ Erro ao processar mensagem ${originalMsgId}:`, err.message);
    }
  }

  saveJson(jsonData);
  console.log(`\n✅ Concluído! ${salvos} thread(s) configurada(s).`);
  client.destroy();
});

client.login(process.env.BOT_TOKEN);
