const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, REST, Routes, Collection } = require("discord.js");
const { Player, QueryType } = require("discord-player");
const { DefaultExtractors } = require("@discord-player/extractor");
const { YoutubeiExtractor } = require("discord-player-youtubei");
require('dotenv').config();
const { ActivityType } = require('discord.js');
const config = require("./config.json");

// Global error handlers to prevent crashes
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    
    // Additional safety: check if it's a YouTube download error
    try {
        if (error && error.message && (
            error.message.includes("Downloading of") || 
            error.message.includes("download failed")
        )) {
            console.log('Caught YouTube download error at process level');
            
            // Check if it might be an IP block
            if (error.message.includes("status code: 403") || 
                error.message.includes("status code: 429") ||
                error.message.includes("Status code: 403") ||
                error.message.includes("Status code: 429")) {
                console.log('Possible YouTube IP block detected');
                // Note: We cannot access Discord channels from this global context
                // We just log it here - the playerError handler will handle notification
            }
            
            // Don't do anything else - this prevents the app from crashing
            // The error has been logged, which is sufficient
        }
    } catch (e) {
        console.error('Error in uncaughtException handler:', e);
    }
    
    // Don't exit the process
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Promise Rejection:', reason);
    // Log the promise that caused the rejection
    console.log('Rejection at:', promise);
    
    // Additional safety: check if it's a YouTube download error
    try {
        if (reason && reason.message && (
            reason.message.includes("Downloading of") || 
            reason.message.includes("download failed")
        )) {
            console.log('Caught YouTube download error (promise rejection) at process level');
            
            // Check if it might be an IP block
            if (reason.message.includes("status code: 403") || 
                reason.message.includes("status code: 429") ||
                reason.message.includes("Status code: 403") ||
                reason.message.includes("Status code: 429")) {
                console.log('Possible YouTube IP block detected in promise rejection');
                
                // We'll use a global flag to indicate IP blocking was detected
                // This will be checked by any active queue handlers
                global.isYouTubeIpBlocked = true;
            }
            
            // Don't do anything else - this prevents the app from crashing
            // The error has been logged, which is sufficient
        }
    } catch (e) {
        console.error('Error in unhandledRejection handler:', e);
    }
    
    // Don't exit the process
});

// Global flag to track if we've detected an IP block
global.isYouTubeIpBlocked = false;

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
        highWaterMark: 1 << 25, // 32MB buffer
    },
    // Add specific error handling for extraction and download failures
    skipOnFail: true, // Important: Don't crash on failed tracks, try to skip
    connectionTimeout: 60000, // Give enough time for connections
    async extractorStreamStrategy(track) {
        try {
            // Normal extraction process
            return await this.stream(track);
        } catch (error) {
            console.error(`Extraction error for track ${track.title}: ${error.message}`);
            
            // Create a guildId variable we can use through the error handling
            const guildId = track.metadata?.guild?.id;
            if (!guildId) {
                throw error; // If we don't have guild ID, we can't handle it
            }
            
            // Trigger manual error event to handle fallback
            const queue = this.nodes.get(guildId);
            if (queue) {
                this.events.emit('playerError', queue, error, track);
                // Return a placeholder to prevent crash, the playerError will handle the fallback
                return null;
            }
            
            // If we couldn't handle it, rethrow
            throw error;
        }
    }
});

// Make fallbackTracksMap accessible to other modules
player.fallbackTracksMap = fallbackTracksMap;
player.attemptedTracksSet = attemptedTracksSet;

// Monkey patch to override error-prone methods in YoutubeiExtractor
try {
    // Find the YoutubeiExtractor prototype
    const YTExtractorProto = Object.getPrototypeOf(player.extractors.get("youtubei"));
    
    // Store the original stream method
    const originalStream = YTExtractorProto.stream;
    
    // Override the stream method with a safer version
    YTExtractorProto.stream = async function(track) {
        try {
            // Call the original method
            return await originalStream.call(this, track);
        } catch (error) {
            console.error(`YoutubeiExtractor stream error caught for ${track.title}: ${error.message}`);
            
            // If it's a download error, handle it gracefully
            if (error.message.includes("Downloading of") || error.message.includes("download failed")) {
                console.log(`Download error for track ${track.title} - handled by monkey patch`);
                
                // Create a more specific error that will be handled by our error system
                const enhancedError = new Error(`Could not extract stream from YouTube: ${error.message}`);
                enhancedError.track = track;
                throw enhancedError;
            }
            
            // Rethrow other errors
            throw error;
        }
    };
    
    console.log("Successfully applied monkey patch to YoutubeiExtractor");
} catch (patchError) {
    console.error("Failed to apply monkey patch to YoutubeiExtractor:", patchError.message);
    // Don't crash if the patch fails, the bot will still work with our other error handlers
}

// Register extractors
async function setupExtractors() {
    try {
        // Register the YoutubeiExtractor with enhanced options
        try {
            player.extractors.register(YoutubeiExtractor, {
                // Improved options for better streaming reliability
                streamOptions: {
                    highWaterMark: 1 << 25, // 32MB for smoother streaming
                    dlChunkSize: 0, // Set to 0 to avoid download issues
                    begin: 0 // Start from the beginning
                },
                // Try using YT Music bridge mode which might have better success rates
                overrideBridgeMode: "ytmusic",
                // Disable the JavaScript player to use more reliable methods
                disablePlayer: true
            });
            console.log('YoutubeiExtractor registered successfully');
        } catch (ytError) {
            console.error('Error registering YoutubeiExtractor:', ytError);
            // Continue even if YoutubeiExtractor fails - we'll fall back to default extractors
        }
        
        // For v7, we pass an array of extractor classes
        // Important: DefaultExtractors is already an array in v7
        await player.extractors.loadMulti(DefaultExtractors);
        
        // Explicitly register the AttachmentExtractor to ensure it's available for file playback
        try {
            const { AttachmentExtractor } = require('@discord-player/extractor');
            player.extractors.register(AttachmentExtractor, {});
            console.log('AttachmentExtractor registered successfully');
        } catch (attachError) {
            console.error('Error registering AttachmentExtractor:', attachError);
            // This is not critical as it should already be loaded via DefaultExtractors
        }
        
        console.log('Extractors loaded successfully');
    } catch (error) {
        console.error('Error loading extractors:', error);
        // Don't crash if extractor setup fails, the bot will still work with limited functionality
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
    
    // Helper function to check if we're being IP blocked by YouTube
    const checkForIpBlock = (errorMessage) => {
        // Check common signs of IP blocking
        const ipBlockSigns = [
            "status code: 403",
            "Status code: 403",
            "status code: 429", 
            "Status code: 429",
            "Too many requests",
            "Access denied"
        ];
        
        return ipBlockSigns.some(sign => errorMessage.includes(sign)) || global.isYouTubeIpBlocked;
    };
    
    // Helper function to check for network timeouts
    const isNetworkTimeout = (error) => {
        return (error.message && error.message.includes("fetch failed")) || 
               (error.cause && error.cause.code === "ETIMEDOUT") ||
               (error.message && error.message.includes("ETIMEDOUT")) ||
               (error.message && error.message.includes("network timeout"));
    };
    
    // Utility function to safely play a track and handle errors
    const safeNodePlay = async (trackToPlay) => {
        try {
            return await queue.node.play(trackToPlay);
        } catch (err) {
            console.error(`Safe node play caught error: ${err.message}`);
            
            // Check for IP blocking here too
            if (checkForIpBlock(err.message)) {
                if (queue.metadata) {
                    queue.metadata.send({
                        content: `⛔ | **YouTube has blocked our server's IP address.** The bot will now disconnect to prevent further errors. Please try again later or try a different source like Spotify or SoundCloud.`
                    });
                    
                    // Clean up the queue
                    setTimeout(() => {
                        try {
                            if (queue.connection) {
                                queue.connection.disconnect();
                            }
                            queue.delete();
                        } catch (e) {
                            console.error(`Error disconnecting in safeNodePlay: ${e.message}`);
                        }
                    }, 500);
                }
                return null;
            }
            
            // Don't throw, just return null to indicate failure
            return null;
        }
    };
    
    // Check if this is an attachment track that failed
    if (track._isAttachment) {
        console.log(`[${queue.guild.name}] Detected error playing attachment: ${track._originalAttachmentName || track.title}`);
        
        // Check if this is a Twitter audio file
        if (track._isTwitterAudio) {
            console.log(`[${queue.guild.name}] Error playing Twitter audio file`);
            
            if (queue.metadata) {
                queue.metadata.send({
                    content: `❌ | Failed to play Twitter audio file: **${track._originalAttachmentName || track.title}**. Twitter audio files may not be supported or have a special format. Try converting it to a standard MP3 file before uploading.`
                });
            }
        } 
        // For regular attachments
        else {
            if (queue.metadata) {
                queue.metadata.send({
                    content: `❌ | Failed to play attachment: **${track._originalAttachmentName || track.title}**. Error: ${error.message}`
                });
            }
        }
        
        // Try to play the next song in the queue if there is one
        if (queue.isPlaying() === false && queue.tracks.size > 0) {
            const nextTrack = queue.tracks.data[0];
            queue.tracks.remove(0);
            queue.node.play(nextTrack)
                .catch(err => {
                    console.error(`Error playing next track after attachment failure: ${err.message}`);
                    if (queue.metadata) {
                        queue.metadata.send({
                            content: `❌ | Error playing next track: ${err.message}`
                        });
                    }
                });
        }
        return;
    }
    
    // Handle IP blocking specifically
    if (checkForIpBlock(error.message)) {
        console.log(`[${queue.guild.name}] Detected YouTube IP blocking during playback`);
        
        if (queue.metadata) {
            queue.metadata.send({
                content: `⛔ | **YouTube has blocked our server's IP address.** The bot will now disconnect to prevent further errors. Please try again later or try a different source like Spotify or SoundCloud.`
            });
            
            // Destroy the queue after a short delay to allow the message to be sent
            setTimeout(() => {
                try {
                    if (queue.connection) {
                        queue.connection.disconnect();
                    }
                    queue.delete();
                    console.log(`[${queue.guild.name}] Queue destroyed due to YouTube IP block`);
                } catch (disconnectError) {
                    console.error(`Error disconnecting after IP block: ${disconnectError.message}`);
                }
                
                // Reset the IP block flag after handling it in this guild
                global.isYouTubeIpBlocked = false;
            }, 500);
            
            return;
        }
    }
    
    // Handle network timeout errors
    else if (isNetworkTimeout(error)) {
        console.log(`[${queue.guild.name}] Network timeout error detected during playback: ${error.message}`);
        
        if (queue.metadata) {
            queue.metadata.send({
                content: `⚠️ | **Network timeout error while connecting to YouTube.** This could be temporary. Trying to continue...`
            });
            
            // Similar approach as YouTube errors - try fallbacks or alternative searches
            // This reuses our existing fallback mechanism
            
            // Get guild ID from the queue
            const guildId = queue.guild.id;
            
            // Track the attempted URL to prevent infinite loops
            if (!player.attemptedTracksSet.has(guildId)) {
                player.attemptedTracksSet.set(guildId, new Set());
            }
            player.attemptedTracksSet.get(guildId).add(track.url);
            
            // Check for fallback tracks or try searching by title, reusing existing code
            if (player.fallbackTracksMap.has(guildId) && player.fallbackTracksMap.get(guildId).length > 0) {
                // Set flag that we're handling a fallback to prevent disconnect message
                queue._handlingFallback = true;
                
                const fallbackTracks = player.fallbackTracksMap.get(guildId);
                const fallbackTrack = fallbackTracks.shift(); // Get next track and remove from array
                
                console.log(`Got fallback track after network timeout: ${fallbackTrack ? fallbackTrack.title : "none"}`);
                
                if (fallbackTrack) {
                    const fallbackIndex = 3 - fallbackTracks.length;
                    
                    // Add a marker to the track that it's a fallback attempt
                    fallbackTrack._fallbackAttempt = true;
                    fallbackTrack._fallbackAttemptNumber = fallbackIndex;
                    
                    if (queue.metadata) {
                        queue.metadata.send({
                            content: `▶️ | Network error occurred. Trying alternative (${fallbackIndex}/3): **${fallbackTrack.title}**`
                        });
                    }
                    
                    // Attempt to play the fallback track - reuse safeNodePlay
                    try {
                        console.log(`Attempting to play fallback track after timeout: ${fallbackTrack.title}`);
                        
                        // Small delay to ensure messages appear in correct order
                        setTimeout(() => {
                            safeNodePlay(fallbackTrack)
                                .catch(fallbackError => {
                                    console.error(`Error playing fallback track after timeout: ${fallbackError.message}`);
                                    queue._handlingFallback = false;
                                    
                                    if (queue.metadata) {
                                        queue.metadata.send({
                                            content: `❌ | Network issues persist. Please try again later or try a different source like Spotify or SoundCloud.`
                                        });
                                    }
                                });
                        }, 1000);
                    } catch (error) {
                        console.error(`Exception playing fallback after timeout: ${error.message}`);
                        queue._handlingFallback = false;
                        
                        if (queue.metadata) {
                            queue.metadata.send({
                                content: `❌ | Network issues continue. Please try again later.`
                            });
                        }
                    }
                }
            } else {
                // Try searching for an alternative if no fallbacks available
                if (queue.metadata && track.title) {
                    queue.metadata.send({
                        content: `🔍 | Trying to find an alternative version of: **${track.title}**`
                    });
                    
                    // Set flag that we're handling a fallback to prevent disconnect message
                    queue._handlingFallback = true;
                    
                    // Try searching for the title instead of using the direct link
                    try {
                        setTimeout(async () => {
                            const searchResults = await player.search(`${track.title} audio`, { requestedBy: track.requestedBy });
                            
                            if (searchResults && searchResults.tracks.length > 0) {
                                // Get the first result that isn't the same URL
                                const alternative = searchResults.tracks.find(t => t.url !== track.url);
                                
                                if (alternative) {
                                    alternative._fallbackAttempt = true;
                                    
                                    if (queue.metadata) {
                                        queue.metadata.send({
                                            content: `▶️ | Found alternative version: **${alternative.title}**`
                                        });
                                    }
                                    
                                    safeNodePlay(alternative)
                                        .catch(altError => {
                                            console.error(`Error playing alternative after timeout: ${altError.message}`);
                                            queue._handlingFallback = false;
                                            
                                            if (queue.metadata) {
                                                queue.metadata.send({
                                                    content: `❌ | Network issues persist. Please try again later or try a different platform.`
                                                });
                                            }
                                        });
                                } else {
                                    queue._handlingFallback = false;
                                    if (queue.metadata) {
                                        queue.metadata.send({
                                            content: `❌ | Network issues connecting to YouTube. Please try again later or try a different platform like SoundCloud.`
                                        });
                                    }
                                }
                            } else {
                                queue._handlingFallback = false;
                                if (queue.metadata) {
                                    queue.metadata.send({
                                        content: `❌ | Network issues connecting to YouTube. Please try again later.`
                                    });
                                }
                            }
                        }, 1000);
                    } catch (searchError) {
                        console.error(`Error searching after timeout: ${searchError.message}`);
                        queue._handlingFallback = false;
                        
                        if (queue.metadata) {
                            queue.metadata.send({
                                content: `❌ | Continuing network issues. Please try again later.`
                            });
                        }
                    }
                } else {
                    // No fallbacks and can't search - just notify the user
                    if (queue.metadata) {
                        queue.metadata.send({
                            content: `❌ | Network timeout connecting to YouTube. Please try again later.`
                        });
                    }
                }
            }
        }
        return;
    }
    
    // Handle all YouTube download-related errors, including from extractors
    if (error.message.includes("Downloading of") || 
        error.message.includes("download failed") ||
        error.message.includes("Could not extract stream") || 
        error.message.includes("Status code: 410") || 
        error.message.includes("Status code: 403") ||
        // Handle additional potential errors from extractors
        error.message.includes("No suitable format") ||
        error.message.includes("This video is unavailable") ||
        error.message.includes("Sign in to confirm your age") ||
        error.message.includes("This video requires payment")) {
    
        // Check if this is a SoundCloud track that failed - check both ways to identify SoundCloud tracks
        if ((track._isDirectStream && track._fromExternalSource && track._originalQuery?.includes('soundcloud.com')) ||
            track._isSoundCloud) {
            if (queue.metadata) {
                queue.metadata.send({
                    content: `❌ | Failed to play track from SoundCloud: **${track.title}**. Error: ${error.message}`
                });
            }
            return;
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
                        try {
                            safeNodePlay(fallbackTrack)
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
                                        
                                        try {
                                            safeNodePlay(nextFallback)
                                                .catch(lastError => {
                                                    console.error(`Error playing last fallback track: ${lastError.message}`);
                                                    queue._handlingFallback = false;
                                                    
                                                    if (queue.metadata) {
                                                        queue.metadata.send({
                                                            content: `❌ | All alternative tracks failed due to YouTube restrictions. Please try a different search query like "${track.title} lyrics" or "${track.title} audio".`
                                                        });
                                                    }
                                                });
                                        } catch (err) {
                                            console.error(`Exception during queue.node.play for nextFallback: ${err.message}`);
                                            queue._handlingFallback = false;
                                            
                                            if (queue.metadata) {
                                                queue.metadata.send({
                                                    content: `❌ | Error during fallback: ${err.message}. Please try a different search query.`
                                                });
                                            }
                                        }
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
                        } catch (outerError) {
                            console.error(`Exception during queue.node.play for fallbackTrack: ${outerError.message}`);
                            queue._handlingFallback = false;
                            
                            // Try to recover by playing the next fallback if available
                            if (fallbackTracks.length > 0) {
                                const nextFallback = fallbackTracks.shift();
                                
                                if (queue.metadata) {
                                    queue.metadata.send({
                                        content: `❌ | Error during first fallback. Trying next alternative: **${nextFallback.title}**`
                                    });
                                }
                                
                                try {
                                    safeNodePlay(nextFallback)
                                        .catch(e => {
                                            console.error(`Error playing recovery fallback: ${e.message}`);
                                            queue._handlingFallback = false;
                                            
                                            if (queue.metadata) {
                                                queue.metadata.send({
                                                    content: `❌ | All alternatives failed. Please try a different search query.`
                                                });
                                            }
                                        });
                                } catch (err) {
                                    console.error(`Exception during recovery play: ${err.message}`);
                                    queue._handlingFallback = false;
                                    
                                    if (queue.metadata) {
                                        queue.metadata.send({
                                            content: `❌ | Error during fallback: ${err.message}. Please try a different search query.`
                                        });
                                    }
                                }
                            } else {
                                if (queue.metadata) {
                                    queue.metadata.send({
                                        content: `❌ | Error during fallback and no more alternatives available. Please try a different search query.`
                                    });
                                }
                            }
                        }
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
                                
                                safeNodePlay(firstAlternative)
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
        // Standard message for all other tracks
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

// Listen for users leaving voice channels
client.on("voiceStateUpdate", (oldState, newState) => {
    // Check if a user has left a voice channel
    if (oldState.channelId && !newState.channelId) {
        const guild = oldState.guild;
        const channel = oldState.channel;
        
        // If the bot is in a voice channel in this guild
        if (guild.members.me.voice.channel) {
            const botVoiceChannel = guild.members.me.voice.channel;
            
            // Get current queue for this guild
            const queue = player.nodes.get(guild.id);
            
            // Check if the bot is the only one left in the voice channel
            if (botVoiceChannel.members.size === 1 && queue && queue.isPlaying()) {
                // Get the text channel associated with the player
                const textChannel = queue.metadata;
                
                if (textChannel) {
                    textChannel.send("👋 | No one in voice channel, leaving...");
                    
                    // We don't need to manually disconnect as leaveOnEmpty is set to true
                    // The bot will automatically leave due to the leaveOnEmpty setting
                }
            }
        }
    }
});

client.login(process.env.TOKEN);
