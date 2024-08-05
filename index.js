const { Client, GatewayIntentBits, REST, Routes } = require("discord.js");
const { Player } = require("discord-player");
require("@discord-player/extractor");
const { YoutubeiExtractor } = require("discord-player-youtubei")
require('dotenv').config();
const { ActivityType } = require('discord.js');
const config = require("./config.json");

const client = new Client({
    intents: [
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.Guilds
    ]
});

const commands = [
    {
        name: 'play',
        description: 'Plays a song from YouTube',
        options: [
            {
                name: 'query',
                type: 3,
                description: 'The song you want to play',
                required: true
            }
        ]
    },
    {
        name: 'skip',
        description: 'Skip to the next song in the queue'
    },
    {
        name: 'stop',
        description: 'Stops the music and clears the queue'
    },
    {
        name: 'deploy',
        description: 'Manually deploy slash commands (Admin only)'
    },
    {
        name: 'queue',
        description: 'Shows the current music queue'
    },
    {
        name: 'remove',
        description: 'Remove a track from the queue by its number',
        options: [
            {
                name: 'number',
                type: 4, // INTEGER type
                description: 'The queue number of the track to remove',
                required: true
            }
        ]
    },
];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

async function deployCommands(guildId) {
    try {
        console.log(`Started refreshing application (/) commands for guild ${guildId}.`);

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
    
    // Set the activity
    client.user.setActivity(config.activity.name, { 
        type: ActivityType[config.activity.type]
    });

    // Deploy commands to all guilds
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

player.extractors.register(YoutubeiExtractor, {})

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

    const { commandName } = interaction;
    const member = interaction.member;
    const voiceChannel = member.voice.channel;

    if (commandName === "deploy") {
        if (!interaction.member.permissions.has("ADMINISTRATOR")) {
            return interaction.reply({ content: "You need to be an administrator to use this command!", ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        await deployCommands(interaction.guildId);
        return interaction.followUp({ content: "Slash commands have been redeployed!", ephemeral: true });
    }

    if (!voiceChannel) {
        return interaction.reply({ content: "You need to be in a voice channel!", ephemeral: true });
    }

    if (interaction.guild.members.me.voice.channelId && voiceChannel.id !== interaction.guild.members.me.voice.channelId) {
        return interaction.reply({ content: "I'm already in a different voice channel!", ephemeral: true });
    }

    if (commandName === "play") {
        await interaction.deferReply();

        const query = interaction.options.getString("query", true);
        const searchResult = await player.search(query, { requestedBy: interaction.user }).catch(() => {});
        if (!searchResult || !searchResult.tracks.length)
            return interaction.followUp({ content: "No results were found!" });

        try {
            const { track } = await player.play(voiceChannel, searchResult, {
                nodeOptions: {
                    metadata: interaction.channel
                }
            });

            return interaction.followUp({ content: `⏱ | Loading track **${track.title}**!` });
        } catch (error) {
            console.error("Error in play command:", error);
            return interaction.followUp({ content: `There was an error while executing this command: ${error}` });
        }
    } else if (commandName === "skip") {
        await interaction.deferReply();
        const queue = player.nodes.get(interaction.guildId);
        if (!queue || !queue.isPlaying())
            return interaction.followUp({ content: "❌ | No music is being played!" });
        
        const currentTrack = queue.currentTrack;
        const success = queue.node.skip();
        return interaction.followUp({
            content: success ? `✅ | Skipped **${currentTrack.title}**!` : "❌ | Something went wrong!"
        });
    } else if (commandName === "stop") {
        await interaction.deferReply();
        const queue = player.nodes.get(interaction.guildId);
        if (!queue || !queue.isPlaying())
            return interaction.followUp({ content: "❌ | No music is being played!" });
        
        queue.delete();
        return interaction.followUp({ content: "🛑 | Stopped the player!" });
    }
    else if (commandName === "queue") {
        const queue = player.nodes.get(interaction.guildId);
        if (!queue || !queue.isPlaying()) {
            return interaction.reply({ content: "❌ | No music is being played!", ephemeral: true });
        }
        
        const currentTrack = queue.currentTrack;
        const tracks = queue.tracks.toArray();
    
        let response = `**Currently Playing:**\n${currentTrack.title}\n\n`;
    
        if (tracks.length) {
            response += `**Queue:**\n${tracks.map((track, i) => `${i + 1}. ${track.title}`).join("\n")}`;
        }
    
        return interaction.reply({ content: response });
    }
    else if (commandName === "remove") {
        const queue = player.nodes.get(interaction.guildId);
        if (!queue || !queue.isPlaying()) {
            return interaction.reply({ content: "❌ | No music is being played!", ephemeral: true });
        }
    
        const trackNum = interaction.options.getInteger("number");
        if (trackNum <= 0 || trackNum > queue.tracks.size) {
            return interaction.reply({ content: "❌ | Invalid track number!", ephemeral: true });
        }
    
        const removedTrack = queue.tracks.toArray()[trackNum - 1];
        queue.removeTrack(trackNum - 1);
    
        return interaction.reply({ content: `🗑️ | Removed track **${removedTrack.title}** from the queue.` });
    }
});

client.login(process.env.TOKEN);
