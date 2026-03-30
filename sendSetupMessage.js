require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once('ready', async () => {
  console.log(`✅ Logado como ${client.user.tag}`);

  try {
    const canal = await client.channels.fetch(process.env.SETUP_CHANNEL_ID);

    const botao = new ButtonBuilder()
      .setCustomId('iniciar_avaliacao')
      .setLabel('📋  Iniciar Avaliação')
      .setStyle(ButtonStyle.Primary);

    await canal.send({
      content: '## 📋 Avaliação de Piloto\nClique no botão abaixo para iniciar uma nova avaliação.',
      components: [new ActionRowBuilder().addComponents(botao)],
    });

    console.log('✅ Mensagem postada com sucesso!');
  } catch (err) {
    console.error('❌ Erro:', err.message);
  }

  client.destroy();
});

client.login(process.env.BOT_TOKEN);
