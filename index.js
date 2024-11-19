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
    overrideBridgeMode: "yt",
    streamOptions: {
        useClient: "ANDROID",
        highWaterMark: 1 << 25
    },
    overrideDownloadOptions: {
        quality: "lowest",
        filter: "audioonly",
        format: "mp3",
        requestOptions: {
            maxRetries: 3,
            maxReconnects: 3
        }
    },
    disablePlayer: false,
    innertubeConfigRaw: {
        client: {
            clientName: 'ANDROID',
            clientVersion: '17.31.35',
            androidSdk: 30,
            userAgent: 'com.google.android.youtube/17.31.35 (Linux; U; Android 11) gzip'
        }
    }
});

player.extractors.loadDefault((ext) => ext !== 'YouTubeExtractor').then(r => console.log('Extractors loaded successfully'));

player.events.on("error", (queue, error) => {
    console.error(`[${queue.guild.name}] General Error:`, error.message);
});

player.events.on("playerError", (queue, error) => {
    console.error(`[${queue.guild.name}] Player Error:`, error.message);
    
    if (error.message.includes("No matching formats found")) {
        if (queue.metadata) {
            queue.metadata.send("⚠️ Sorry, this track couldn't be played due to format restrictions. Skipping to next song...");
        }
        
        if (queue.tracks.size > 0) {
            queue.node.skip();
        }
    }
});

player.events.on("playerStart", (queue, track) => {
    if (queue.metadata) queue.metadata.send(`🎶 | Started playing: **${track.title}** in **${queue.channel.name}**!`);
});

player.events.on("playerSkip", (queue, track) => {
    console.log(`[${queue.guild.name}] Track ${track.title} was skipped due to an issue`);
});

player.events.on("playerFinish", (queue, track) => {
    console.log(`[${queue.guild.name}] Track ${track.title} finished playing normally`);
});

player.events.on("connectionError", (queue, error) => {
    console.error(`[${queue.guild.name}] Connection Error:`, error);
});

player.events.on("disconnect", (queue) => {
    console.log(`[${queue.guild.name}] Disconnected from voice channel`);
});

player.events.on("emptyChannel", (queue) => {
    console.log(`[${queue.guild.name}] Nobody is in the voice channel, leaving...`);
});

player.events.on("emptyQueue", (queue) => {
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
