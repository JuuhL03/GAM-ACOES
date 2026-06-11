const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', async () => {
  console.log(`✅ Bot conectado como ${client.user.tag}\n`);
  await listarThreads();
  process.exit(0);
});

async function listarThreads() {
  const CHANNEL_ID = process.env.THREAD_CHANNEL_ID;
  
  if (!CHANNEL_ID) {
    console.error('❌ THREAD_CHANNEL_ID não configurado no .env');
    process.exit(1);
  }
  
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    
    console.log(`📂 Canal: ${channel.name}\n`);
    
    // Threads ativas
    const ativas = await channel.threads.fetchActive();
    const arquivadas = await channel.threads.fetchArchived();
    
    console.log(`✅ THREADS ATIVAS (${ativas.size}):`);
    if (ativas.size === 0) {
      console.log(`   Nenhuma thread ativa encontrada\n`);
    } else {
      for (const thread of ativas.values()) {
        const diasAtras = Math.floor((Date.now() - thread.createdTimestamp) / (24 * 60 * 60 * 1000));
        console.log(`   • ${thread.name}`);
        console.log(`     ID: ${thread.id} | Criada há ${diasAtras}d\n`);
      }
    }
    
    console.log(`\n🗂️  THREADS ARQUIVADAS (${arquivadas.size}):`);
    if (arquivadas.size === 0) {
      console.log(`   Nenhuma thread arquivada encontrada\n`);
    } else {
      for (const thread of arquivadas.values()) {
        const diasAtras = Math.floor((Date.now() - thread.createdTimestamp) / (24 * 60 * 60 * 1000));
        console.log(`   • ${thread.name}`);
        console.log(`     ID: ${thread.id} | Criada há ${diasAtras}d\n`);
      }
    }
    
    console.log(`\n${'='.repeat(50)}`);
    console.log(`📊 RESUMO`);
    console.log(`${'='.repeat(50)}`);
    console.log(`✅ Threads ativas: ${ativas.size}`);
    console.log(`🗂️  Threads arquivadas: ${arquivadas.size}`);
    console.log(`📌 Total: ${ativas.size + arquivadas.size}\n`);
    
  } catch (err) {
    console.error('❌ Erro:', err.message);
  }
}

client.login(process.env.BOT_TOKEN);