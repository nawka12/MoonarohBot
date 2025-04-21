// commands/attachment.js
const { QueryType } = require('discord-player');

module.exports = {
    name: 'attachment',
    description: 'Plays a song from a Discord attachment',
    options: [
        {
            name: 'attachment',
            type: 11, // 11 corresponds to Attachment type in Discord API
            description: 'The audio file to play',
            required: true
        }
    ],
    
    async execute(interaction, player, skipDefer = false) {
        // Only defer reply if not already deferred
        if (!skipDefer) {
            await interaction.deferReply();
        }
        
        // Get the attachment from the interaction
        const attachment = interaction.options.getAttachment('attachment');
        
        if (!attachment) {
            return interaction.followUp({ content: "❌ | You need to provide an audio file attachment!" });
        }
        
        console.log(`Processing attachment: ${attachment.name}, URL: ${attachment.url}, Content-Type: ${attachment.contentType}`);
        
        // Check if the attachment is an audio file
        const supportedFormats = ['audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/flac', 'audio/x-m4a', 'video/mp4'];
        const fileExtension = attachment.name.split('.').pop().toLowerCase();
        const supportedExtensions = ['mp3', 'ogg', 'wav', 'flac', 'm4a', 'mp4'];
        
        if (
            !supportedFormats.some(format => attachment.contentType?.includes(format)) && 
            !supportedExtensions.includes(fileExtension)
        ) {
            return interaction.followUp({ 
                content: "❌ | The attachment must be an audio file (MP3, OGG, WAV, FLAC, M4A)!" 
            });
        }
        
        // Get voice channel
        const member = interaction.member;
        const voiceChannel = member.voice.channel;
        
        if (!voiceChannel) {
            return interaction.followUp({ content: "❌ | You need to be in a voice channel!" });
        }
        
        try {
            await interaction.followUp({ content: `🔍 | Processing attachment: **${attachment.name}**...` });
            
            // Special handling for Twitter audio files
            const isTwitterAudio = attachment.name.includes('twitter') && fileExtension === 'mp3';
            
            console.log(`Is Twitter audio file: ${isTwitterAudio}`);
            
            // Use Discord Player first for most formats
            let searchResult = null;
            
            // For Twitter audio, try both QueryType.AUTO and QueryType.FILE
            if (!isTwitterAudio) {
                // Normal handling for non-Twitter files
                searchResult = await player.search(attachment.url, { 
                    requestedBy: interaction.user,
                    searchEngine: QueryType.FILE
                }).catch((error) => {
                    console.error(`Attachment search error: ${error.message}`);
                    console.error(error.stack);
                    return null;
                });
            } else {
                // Try multiple methods for Twitter files
                // First with AUTO
                searchResult = await player.search(attachment.url, { 
                    requestedBy: interaction.user,
                    searchEngine: QueryType.AUTO
                }).catch((error) => {
                    console.error(`Twitter audio search error (AUTO): ${error.message}`);
                    return null;
                });
                
                // If that fails, try FILE
                if (!searchResult || !searchResult.tracks.length) {
                    searchResult = await player.search(attachment.url, { 
                        requestedBy: interaction.user,
                        searchEngine: QueryType.FILE
                    }).catch((error) => {
                        console.error(`Twitter audio search error (FILE): ${error.message}`);
                        return null;
                    });
                }
                
                // If both fail, try with a direct URL
                if (!searchResult || !searchResult.tracks.length) {
                    console.log("Discord Player couldn't process Twitter audio. Trying raw URL...");
                    
                    // Try using the raw URL as a track
                    searchResult = await player.search(attachment.url, {
                        requestedBy: interaction.user,
                        searchEngine: QueryType.AUTO
                    }).catch(error => {
                        console.error(`Raw URL search error: ${error.message}`);
                        return null;
                    });
                }
            }
            
            // Check if the high-level approach worked
            if (!searchResult || !searchResult.tracks.length) {
                console.log("No tracks found in search result. Trying fallback approach...");
                
                // Try a different approach with AUTO search engine
                const fallbackResult = await player.search(attachment.url, {
                    requestedBy: interaction.user,
                    searchEngine: QueryType.AUTO
                }).catch(error => {
                    console.error(`Fallback search error: ${error.message}`);
                    return null;
                });
                
                if (!fallbackResult || !fallbackResult.tracks.length) {
                    // We've tried everything and failed
                    if (isTwitterAudio) {
                        return interaction.followUp({
                            content: "❌ | Could not process this Twitter audio file. Twitter audio files may have compatibility issues with Discord bots. Try converting it to a standard MP3 file before uploading."
                        });
                    } else {
                        return interaction.followUp({
                            content: "❌ | Could not process this attachment as an audio file. Make sure it's a valid audio format."
                        });
                    }
                } else {
                    console.log("Fallback search succeeded!");
                    searchResult = fallbackResult;
                }
            }
            
            // Get the extracted track
            const track = searchResult.tracks[0];
            
            // Add track metadata from the attachment if not available
            if (!track.title) {
                track.title = attachment.name;
            }
            
            console.log(`Track loaded: ${track.title}, URL: ${track.url}, Duration: ${track.duration}`);
            
            // Check if queue already exists
            let queue = player.nodes.get(interaction.guild.id);
            
            // If queue doesn't exist, create it
            if (!queue) {
                queue = player.nodes.create(interaction.guild.id, {
                    metadata: {
                        channel: interaction.channel,
                        client: interaction.guild.members.me,
                        requestedBy: interaction.user,
                        send: (text) => {
                            interaction.channel.send(text);
                        }
                    },
                    volume: 80,
                    leaveOnEmpty: true,
                    leaveOnEmptyCooldown: 300000, // 5 minutes
                    leaveOnEnd: true,
                    leaveOnEndCooldown: 300000, // 5 minutes
                    selfDeaf: true
                });
            }
            
            try {
                // Attempt to join the voice channel if not already connected
                if (!queue.connection) {
                    await queue.connect(voiceChannel);
                }
            } catch (error) {
                // Destroy the queue if we fail to join the voice channel
                player.nodes.delete(interaction.guild.id);
                return interaction.followUp({ 
                    content: `❌ | Could not join your voice channel: ${error.message}`
                });
            }
            
            // Mark this track as an attachment to help with error handling
            track._isAttachment = true;
            track._originalAttachmentName = attachment.name;
            track._isTwitterAudio = isTwitterAudio;
            
            const isQueueEmpty = !queue.isPlaying();
            
            // Add the track to the queue
            queue.addTrack(track);
            
            // If queue was empty, start playing
            if (isQueueEmpty) {
                await queue.node.play();
                return interaction.followUp({ 
                    content: `🎵 | Started playing attachment: **${track.title || attachment.name}**!`
                });
            } else {
                // Otherwise, inform that it's been added to the queue
                return interaction.followUp({ 
                    content: `🎶 | Added attachment **${track.title || attachment.name}** to the queue!`
                });
            }
            
        } catch (error) {
            console.error(`Error playing attachment: ${error.message}`);
            console.error(error.stack);
            
            if (error.message.includes('unsupported format') || error.message.includes('No suitable format')) {
                return interaction.followUp({ 
                    content: `❌ | This audio format is not supported. If it's a Twitter audio file, try converting it to a standard MP3 format before uploading.`
                });
            }
            
            return interaction.followUp({ 
                content: `❌ | An error occurred: ${error.message}. Twitter audio files may not be supported.`
            });
        }
    }
}; 