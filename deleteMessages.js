require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

// ── IDs das mensagens ORIGINAIS (do canal principal) ──────────────────────────
// O script vai achar a thread de cada uma e apagar as mensagens do bot lá dentro
const ORIGINAL_MSG_IDS = [
  ''
];

// ── IDs específicos de mensagens pra apagar dentro das threads (opcional) ─────
// Se quiser apagar mensagens específicas pelo ID, coloca aqui.
// Se deixar vazio [], o script apaga TODAS as mensagens do bot em cada thread.
const MSG_IDS_ESPECIFICOS = [
  ''
];
// ─────────────────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', async () => {
  console.log(`✅ Logado como ${client.user.tag}`);

  const canal = await client.channels.fetch(process.env.THREAD_CHANNEL_ID);

  for (const originalMsgId of ORIGINAL_MSG_IDS) {
    try {
      const msg = await canal.messages.fetch(originalMsgId);

      if (!msg.thread) {
        console.log(`⚠️  Mensagem ${originalMsgId} não tem thread associada.`);
        continue;
      }

      const thread = msg.thread;
      console.log(`🔍 Thread encontrada: ${thread.name} (${thread.id})`);

      if (MSG_IDS_ESPECIFICOS.length > 0) {
        // Apaga apenas os IDs específicos
        for (const msgId of MSG_IDS_ESPECIFICOS) {
          try {
            const m = await thread.messages.fetch(msgId);
            await m.delete();
            console.log(`🗑️  Mensagem ${msgId} apagada.`);
          } catch (err) {
            console.error(`❌ Não foi possível apagar ${msgId}:`, err.message);
          }
        }
      } else {
        // Apaga todas as mensagens do bot na thread
        const msgs = await thread.messages.fetch({ limit: 100 });
        const doBot = msgs.filter(m => m.author.id === client.user.id);
        for (const [, m] of doBot) {
          try {
            await m.delete();
            console.log(`🗑️  Mensagem ${m.id} apagada da thread ${thread.name}.`);
          } catch (err) {
            console.error(`❌ Não foi possível apagar ${m.id}:`, err.message);
          }
        }
      }

    } catch (err) {
      console.error(`❌ Erro ao processar mensagem ${originalMsgId}:`, err.message);
    }
  }

  console.log('✅ Pronto! Encerrando...');
  client.destroy();
});

client.login(process.env.BOT_TOKEN);