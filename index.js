const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, REST, Routes, Collection } = require("discord.js");
const { Player } = require("discord-player");
require("@discord-player/extractor");
const { YoutubeiExtractor } = require("discord-player-youtubei");
require('dotenv').config();
const { ActivityType } = require('discord.js');
const config = require("./config.json");
const { env } = require('process');

const client = new Client({
    intents: [
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.Guilds
    ]
});

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    client.commands.set(command.name, command);
}

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

async function deployCommands(guildId) {
    try {
        console.log(`Started refreshing application (/) commands for guild ${guildId}.`);

        const commands = Array.from(client.commands.values());

        await rest.put(
            Routes.applicationGuildCommands(client.application.id, guildId),
            { body: commands },
        );

        console.log(`Successfully reloaded application (/) commands for guild ${guildId}.`);
    } catch (error) {
        console.error(error);
    }
}

client.on("ready", async () => {
    console.log("Bot is online!");
    
    client.user.setActivity(config.activity.name, { 
        type: ActivityType[config.activity.type]
    });

    for (const guild of client.guilds.cache.values()) {
        await deployCommands(guild.id);
    }
});

client.on("guildCreate", (guild) => {
    console.log(`Joined new guild: ${guild.name}`);
    deployCommands(guild.id);
});

client.on("error", console.error);
client.on("warn", console.warn);

const player = new Player(client);

player.extractors.register(YoutubeiExtractor, {
    authentication: process.env.OAUTH_TOKEN ?? "",
    overrideBridgeMode: "yt"
});

player.extractors.loadDefault((ext) => ext !== 'YouTubeExtractor').then(r => console.log('Extractors loaded successfully'));

player.events.on("error", (queue, error) => {
    console.log(`[${queue.guild.name}] Error emitted from the queue: ${error.message}`);
});

player.events.on("playerStart", (queue, track) => {
    if (queue.metadata) queue.metadata.send(`🎶 | Started playing: **${track.title}** in **${queue.channel.name}**!`);
});

player.events.on("audioTrackAdd", (queue, track) => {
    if (queue.metadata) queue.metadata.send(`🎶 | Track **${track.title}** queued!`);
});

player.events.on('emptyQueue', (queue) => {
    if (queue.metadata) queue.metadata.send('Queue finished. Disconnecting from voice channel.');
});

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isCommand() || !interaction.guildId) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) return;

    const member = interaction.member;
    const voiceChannel = member.voice.channel;

    if (interaction.commandName !== "deploy" && !voiceChannel) {
        return interaction.reply({ content: "You need to be in a voice channel!", ephemeral: true });
    }

    if (interaction.guild.members.me.voice.channelId && voiceChannel.id !== interaction.guild.members.me.voice.channelId) {
        return interaction.reply({ content: "I'm already in a different voice channel!", ephemeral: true });
    }

    try {
        await command.execute(interaction, player);
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
    }
});

client.login(process.env.TOKEN);
