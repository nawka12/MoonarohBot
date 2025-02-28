const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, REST, Routes, Collection } = require("discord.js");
const { Player } = require("discord-player");
const { DefaultExtractors } = require("@discord-player/extractor");
const { YoutubeiExtractor } = require("discord-player-youtubei");
require('dotenv').config();
const { ActivityType } = require('discord.js');
const config = require("./config.json");

// Global fallback tracks storage by guild ID
const fallbackTracksMap = new Map();

// Global set to track attempted track URLs to prevent infinite loops
const attemptedTracksSet = new Map();

// Make sure TOKEN exists in environment
console.log('TOKEN exists:', !!process.env.TOKEN);

const client = new Client({
    intents: [
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
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

// Create player instance
const player = new Player(client, {
    ytdlOptions: {
        quality: 'highestaudio',
        highWaterMark: 1 << 25 // 32MB buffer
    }
});

// Make fallbackTracksMap accessible to other modules
player.fallbackTracksMap = fallbackTracksMap;
player.attemptedTracksSet = attemptedTracksSet;

// Register extractors
async function setupExtractors() {
    try {
        // Register the YoutubeiExtractor with enhanced options
        player.extractors.register(YoutubeiExtractor, {
            // Improved options for better streaming reliability
            streamOptions: {
                highWaterMark: 1 << 25 // 32MB for smoother streaming
            },
            // Try using YT Music bridge mode which might have better success rates
            overrideBridgeMode: "ytmusic",
            // Disable the JavaScript player to use more reliable methods
            disablePlayer: true
        });
        
        // For v7, we pass an array of extractor classes
        // Important: DefaultExtractors is already an array in v7
        await player.extractors.loadMulti(DefaultExtractors);
        
        console.log('Extractors loaded successfully');
    } catch (error) {
        console.error('Error loading extractors:', error);
    }
}

setupExtractors();

// Set up player events
player.events.on("error", (queue, error) => {
    console.log(`[${queue.guild.name}] Error emitted from the queue: ${error.message}`);
    
    // Notify the channel about the error
    if (queue.metadata) {
        queue.metadata.send(`❌ | Error in the music queue: ${error.message}`);
    }
});

player.events.on("playerError", (queue, error, track) => {
    console.log(`[${queue.guild.name}] Error emitted from the player while playing ${track.title}: ${error.message}`);
    
    // Check for YouTube extraction errors
    if (error.message.includes("Could not extract stream") || 
        error.message.includes("Status code: 410") || 
        error.message.includes("Status code: 403")) {
        
        if (queue.metadata) {
            queue.metadata.send({
                content: `❌ | Could not play **${track.title}** due to YouTube restrictions.`
            });
        }
        
        // Get guild ID from the queue
        const guildId = queue.guild.id;
        
        // Track the attempted URL to prevent infinite loops
        if (!player.attemptedTracksSet.has(guildId)) {
            player.attemptedTracksSet.set(guildId, new Set());
        }
        player.attemptedTracksSet.get(guildId).add(track.url);
        
        // Log how many tracks we've attempted for this guild
        const attemptCount = player.attemptedTracksSet.get(guildId).size;
        console.log(`Track failed. Total attempted tracks for guild ${guildId}: ${attemptCount}`);
        
        // If we've attempted too many tracks (5 is reasonable), just stop
        if (attemptCount >= 5) {
            console.log(`Reached maximum number of fallback attempts (${attemptCount}). Stopping fallback chain.`);
            
            if (queue.metadata) {
                queue.metadata.send({
                    content: `❌ | I've tried ${attemptCount} different tracks, but they all have YouTube restrictions. Please try a completely different song or artist.`
                });
            }
            
            // Reset the attempts tracking for this guild
            player.attemptedTracksSet.set(guildId, new Set());
            queue._handlingFallback = false;
            return;
        }
        
        // Check for fallback tracks in our Map
        console.log(`Checking for fallback tracks for guild ${guildId}`);
        console.log(`FallbackTracksMap has ${player.fallbackTracksMap.size} entries`);
        
        // If we have fallback tracks for this guild
        if (player.fallbackTracksMap.has(guildId) && player.fallbackTracksMap.get(guildId).length > 0) {
            // Set flag that we're handling a fallback to prevent disconnect message
            queue._handlingFallback = true;
            
            const fallbackTracks = player.fallbackTracksMap.get(guildId);
            const fallbackTrack = fallbackTracks.shift(); // Get next track and remove from array
            
            console.log(`Got fallback track: ${fallbackTrack ? fallbackTrack.title : "none"}`);
            
            if (fallbackTrack) {
                const fallbackIndex = 3 - fallbackTracks.length;
                
                // Add a marker to the track that it's a fallback attempt
                fallbackTrack._fallbackAttempt = true;
                fallbackTrack._fallbackAttemptNumber = fallbackIndex;
                
                if (queue.metadata) {
                    queue.metadata.send({
                        content: `▶️ | Trying alternative (${fallbackIndex}/3): **${fallbackTrack.title}**`
                    });
                }
                
                // Attempt to play the fallback track
                try {
                    console.log(`Attempting to play fallback track: ${fallbackTrack.title}`);
                    
                    // Small delay to ensure messages appear in correct order
                    setTimeout(() => {
                        queue.node.play(fallbackTrack)
                            .catch(fallbackError => {
                                console.error(`Error playing fallback track: ${fallbackError.message}`);
                                
                                // If there are more fallbacks, try the next one
                                if (fallbackTracks.length > 0) {
                                    const nextFallback = fallbackTracks.shift();
                                    nextFallback._fallbackAttempt = true;
                                    nextFallback._fallbackAttemptNumber = 3;
                                    
                                    if (queue.metadata) {
                                        queue.metadata.send({
                                            content: `▶️ | Previous alternative failed too. Trying alternative (3/3): **${nextFallback.title}**`
                                        });
                                    }
                                    
                                    queue.node.play(nextFallback)
                                        .catch(lastError => {
                                            console.error(`Error playing last fallback track: ${lastError.message}`);
                                            queue._handlingFallback = false;
                                            
                                            if (queue.metadata) {
                                                queue.metadata.send({
                                                    content: `❌ | All alternative tracks failed due to YouTube restrictions. Please try a different search query like "${track.title} lyrics" or "${track.title} audio".`
                                                });
                                            }
                                        });
                                } else {
                                    // No more fallbacks
                                    queue._handlingFallback = false;
                                    
                                    if (queue.metadata) {
                                        queue.metadata.send({
                                            content: `❌ | All alternative tracks failed due to YouTube restrictions. Please try a different search query like "${track.title} lyrics" or "${track.title} audio".`
                                        });
                                    }
                                }
                            });
                    }, 1000);
                    
                    return;
                } catch (error) {
                    console.error(`Exception playing fallback: ${error.message}`);
                    queue._handlingFallback = false;
                }
            }
        } else {
            console.log(`No fallback tracks available for guild ${guildId}. Will try searching by title instead.`);
            
            // Set flag that we're handling a fallback to prevent disconnect message
            queue._handlingFallback = true;
            
            // Check if this was a direct URL that failed (only one result found)
            if (queue.metadata && track.url && track.url.includes("youtube.com/watch?v=")) {
                queue.metadata.send({
                    content: `🔍 | No alternatives available. Searching for tracks with title: **${track.title}**`
                });
                
                // Try searching for the title instead of using the direct link
                try {
                    setTimeout(async () => {
                        const searchResults = await player.search(track.title, { requestedBy: track.requestedBy });
                        
                        if (searchResults && searchResults.tracks.length > 1) {
                            // Filter out tracks that we've already tried
                            const filteredTracks = searchResults.tracks
                                .filter(t => !player.attemptedTracksSet.get(guildId).has(t.url))
                                .slice(0, 2); // Get top 2 results that we haven't tried
                            
                            if (filteredTracks.length > 0) {
                                console.log(`Found ${filteredTracks.length} alternative tracks by title that haven't been tried yet`);
                                
                                // Store the remaining alternatives in fallbackTracksMap
                                if (filteredTracks.length > 1) {
                                    player.fallbackTracksMap.set(guildId, [filteredTracks[1]]);
                                }
                                
                                // Play the first alternative
                                const firstAlternative = filteredTracks[0];
                                firstAlternative._fallbackAttempt = true;
                                firstAlternative._fallbackAttemptNumber = 2;
                                
                                if (queue.metadata) {
                                    queue.metadata.send({
                                        content: `▶️ | Found similar track (1/2): **${firstAlternative.title}**`
                                    });
                                }
                                
                                queue.node.play(firstAlternative)
                                    .catch(altError => {
                                        console.error(`Error playing alternative by title: ${altError.message}`);
                                        queue._handlingFallback = false;
                                        
                                        if (queue.metadata) {
                                            queue.metadata.send({
                                                content: `❌ | Failed to play alternative track. Please try a different search query like "${track.title} lyrics".`
                                            });
                                        }
                                    });
                            } else {
                                queue._handlingFallback = false;
                                if (queue.metadata) {
                                    queue.metadata.send({
                                        content: `❌ | Could not find any new alternatives for this track. Try searching for "${track.title} lyrics" or "${track.title} audio" instead, or try a completely different song.`
                                    });
                                }
                                
                                // Reset the attempts tracking for this guild since we're giving up
                                player.attemptedTracksSet.set(guildId, new Set());
                            }
                        } else {
                            queue._handlingFallback = false;
                            if (queue.metadata) {
                                queue.metadata.send({
                                    content: `❌ | Could not find any alternatives for this track. Try searching for "${track.title} lyrics" or "${track.title} audio" instead, or try a completely different song.`
                                });
                            }
                            
                            // Reset the attempts tracking for this guild since we're giving up
                            player.attemptedTracksSet.set(guildId, new Set());
                        }
                    }, 1000);
                } catch (searchError) {
                    console.error(`Error searching for alternatives: ${searchError.message}`);
                    queue._handlingFallback = false;
                    
                    if (queue.metadata) {
                        queue.metadata.send({
                            content: `❌ | Error searching for alternatives. Please try using the title: "${track.title}" instead of a direct link.`
                        });
                    }
                    
                    // Reset the attempts tracking for this guild since we're giving up
                    player.attemptedTracksSet.set(guildId, new Set());
                }
            } else {
                queue._handlingFallback = false;
                
                // If we get here, there were no fallbacks or something went wrong
                if (queue.metadata) {
                    queue.metadata.send({
                        content: `❌ | Could not play this track due to YouTube restrictions. Please try a different search query like "${track.title} lyrics" or "${track.title} audio", or try a completely different song.`
                    });
                }
                
                // Reset the attempts tracking for this guild since we're giving up
                player.attemptedTracksSet.set(guildId, new Set());
            }
        }
    } else {
        // For other player errors
        if (queue.metadata) {
            queue.metadata.send(`❌ | Error playing **${track.title}**: ${error.message}`);
        }
    }
});

player.events.on("playerStart", (queue, track) => {
    // Centralize all "Now playing" messages in this event handler
    // This prevents duplicate or conflicting messages
    
    if (queue.metadata) {
        // If this is a fallback track with a fallback attempt number
        if (track._fallbackAttempt && track._fallbackAttemptNumber) {
            queue.metadata.send(`✅ | Successfully playing alternative (${track._fallbackAttemptNumber}/3): **${track.title}** in **${queue.channel.name}**!`);
        }
        // If this is a fallback track without a number (from title search)
        else if (track._fallbackAttempt) {
            queue.metadata.send(`✅ | Successfully playing alternative: **${track.title}** in **${queue.channel.name}**!`);
        }
        // This is the initial track that was requested
        else {
            queue.metadata.send(`🎶 | Started playing: **${track.title}** in **${queue.channel.name}**!`);
        }
    }
});

player.events.on("audioTrackAdd", (queue, track) => {
    // Only send queued message for tracks that:
    // 1. Aren't fallback attempts (we handle those differently)
    // 2. Weren't auto-selected by the player
    // 3. Aren't about to be played immediately (we'll show "Now playing" instead)
    if (!track._fallbackAttempt && 
        !track.wasAutoSelected && 
        queue.tracks.size > 0 && // Only if there are already tracks in the queue
        queue.metadata) {
        queue.metadata.send(`🎶 | Track **${track.title}** queued!`);
    }
});

player.events.on('emptyQueue', (queue) => {
    // Only show the disconnecting message if we're not in the middle of a fallback attempt
    if (!queue._handlingFallback && queue.metadata) {
        queue.metadata.send('Queue finished. Disconnecting from voice channel.');
    }
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
        // Provide context to the command
        await player.context.provide({ guild: interaction.guild }, () => command.execute(interaction, player));
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
    }
});

client.login(process.env.TOKEN);
