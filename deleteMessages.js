require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

// ── IDs das mensagens que você quer apagar ────────────────────────────────────
const MESSAGE_IDS = [
  '1488296088711467208'
];

// ── ID do canal onde estão as mensagens ──────────────────────────────────────
const CHANNEL_ID = process.env.SETUP_CHANNEL_ID; // ou coloca o ID direto aqui

// ─────────────────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once('ready', async () => {
  console.log(`✅ Logado como ${client.user.tag}`);

  try {
    const canal = await client.channels.fetch(CHANNEL_ID);

    for (const id of MESSAGE_IDS) {
      try {
        const msg = await canal.messages.fetch(id);
        await msg.delete();
        console.log(`🗑️  Mensagem ${id} apagada.`);
      } catch (err) {
        console.error(`❌ Não foi possível apagar ${id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('❌ Erro ao acessar o canal:', err.message);
  }

  console.log('✅ Pronto! Encerrando...');
  client.destroy();
});

client.login(process.env.BOT_TOKEN);
