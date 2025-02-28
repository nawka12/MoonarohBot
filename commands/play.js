// commands/play.js
module.exports = {
    name: 'play',
    description: 'Plays a song from YouTube',
    options: [
        {
            name: 'query',
            type: 3,
            description: 'The song you want to play',
            required: true
        }
    ],
    async execute(interaction, player) {
        await interaction.deferReply();

        const query = interaction.options.getString("query", true);
        const searchResult = await player.search(query, { requestedBy: interaction.user }).catch((error) => {
            console.error("Search error:", error);
            return null;
        });
        
        if (!searchResult || !searchResult.tracks.length)
            return interaction.followUp({ content: "No results were found!" });

        try {
            // Initialize the attempted tracks set for this guild if needed
            const guildId = interaction.guild.id;
            if (!player.attemptedTracksSet.has(guildId)) {
                player.attemptedTracksSet.set(guildId, new Set());
            }
            
            // Reset the attempted tracks set at the beginning of a new command
            player.attemptedTracksSet.set(guildId, new Set());
            
            // Store the top 3 tracks for fallback attempts (or just the one track for direct links)
            const topTracks = searchResult.tracks.slice(0, 3);
            
            // Debug the tracks found
            console.log(`Found ${topTracks.length} tracks for "${query}":`);
            topTracks.forEach((t, i) => {
                console.log(`${i+1}. ${t.title} (${t.url}) - Duration: ${t.duration}`);
            });
            
            // Check if this is a direct YouTube link (will have only one result)
            const isDirectLink = query.includes('youtube.com/watch?v=') || query.includes('youtu.be/');
            
            // Send acknowledgment with appropriate message
            if (isDirectLink) {
                await interaction.followUp({ 
                    content: `⏱ | Loading track from URL: **${query}**\nIf it fails, I'll try searching by title.` 
                });
            } else {
                await interaction.followUp({ 
                    content: `⏱ | Searching for: **${query}**\nFound ${topTracks.length} results, will try alternative tracks if the first one fails.` 
                });
            }

            // Store fallback tracks (even for direct links, we'll use the title for searching later if needed)
            const fallbackTracks = topTracks.length > 1 ? topTracks.slice(1) : [];
            
            // Mark the first track as attempted
            if (topTracks[0] && topTracks[0].url) {
                player.attemptedTracksSet.get(guildId).add(topTracks[0].url);
            }
            
            // Ensure we have the fallbackTracksMap on the player
            if (player.fallbackTracksMap) {
                player.fallbackTracksMap.set(interaction.guild.id, fallbackTracks);
                
                if (fallbackTracks.length > 0) {
                    console.log(`Fallback tracks stored for guild ${interaction.guild.id}: ${fallbackTracks.map(t => t.title).join(", ")}`);
                } else if (isDirectLink) {
                    console.log(`Direct link provided. No immediate fallbacks available, will search by title if it fails.`);
                }
            } else {
                console.error("Error: fallbackTracksMap not available on player");
            }

            // Basic nodeOptions for the player
            const nodeOptions = {
                metadata: interaction.channel,
                leaveOnEmpty: true,
                // leaveOnEmptyCooldown: 300000, // 5 minutes
                leaveOnEnd: true,
                leaveOnEndCooldown: 300000, // 5 minutes
            };

            // Play the first track
            try {
                const result = await player.play(interaction.member.voice.channel, topTracks[0], {
                    nodeOptions: nodeOptions
                });
                
                console.log(`Play result: ${result ? "success" : "failed"}`);
                
                if (result && result.track) {
                    // Let users know about the track being played
                    if (isDirectLink) {
                        await interaction.channel.send({ 
                            content: `🎶 | Now playing: **${result.track.title}**` 
                        });
                    } else {
                        await interaction.channel.send({ 
                            content: `🎶 | Now playing (1/3): **${result.track.title}**` 
                        });
                    }
                }
            } catch (playError) {
                console.error(`Error playing first track: ${playError.message}`);
                
                // Mark that we attempted this track
                if (topTracks[0] && topTracks[0].url) {
                    player.attemptedTracksSet.get(guildId).add(topTracks[0].url);
                }
                
                // Check if we're hitting the maximum attempts limit
                const attemptCount = player.attemptedTracksSet.get(guildId).size;
                if (attemptCount >= 5) {
                    await interaction.channel.send({ 
                        content: `❌ | I've tried ${attemptCount} different tracks, but they all have YouTube restrictions. Please try a completely different song or artist.` 
                    });
                    
                    // Reset the attempts tracking
                    player.attemptedTracksSet.set(guildId, new Set());
                    return;
                }
                
                // Try to play the next track if the first one fails immediately
                if (player.fallbackTracksMap && 
                    player.fallbackTracksMap.has(interaction.guild.id) && 
                    player.fallbackTracksMap.get(interaction.guild.id).length > 0) {
                    
                    const fallbackTracks = player.fallbackTracksMap.get(interaction.guild.id);
                    const fallbackTrack = fallbackTracks.shift();
                    
                    // Mark that we attempted this track
                    if (fallbackTrack && fallbackTrack.url) {
                        player.attemptedTracksSet.get(guildId).add(fallbackTrack.url);
                    }
                    
                    await interaction.channel.send({ 
                        content: `❌ | First track failed immediately. Trying alternative (2/3): **${fallbackTrack.title}**` 
                    });
                    
                    try {
                        const fallbackResult = await player.play(
                            interaction.member.voice.channel,
                            fallbackTrack,
                            { nodeOptions }
                        );
                        
                        if (fallbackResult && fallbackResult.track) {
                            // Mark this as a fallback track
                            fallbackResult.track._fallbackAttempt = true;
                            fallbackResult.track._fallbackAttemptNumber = 2;
                            
                            await interaction.channel.send({ 
                                content: `🎶 | Now playing alternative (2/3): **${fallbackResult.track.title}**` 
                            });
                        }
                    } catch (fallbackError) {
                        console.error(`Error playing fallback track: ${fallbackError.message}`);
                        
                        // Check if we're hitting the maximum attempts limit
                        const attemptCount = player.attemptedTracksSet.get(guildId).size;
                        if (attemptCount >= 5) {
                            await interaction.channel.send({ 
                                content: `❌ | I've tried ${attemptCount} different tracks, but they all have YouTube restrictions. Please try a completely different song or artist.` 
                            });
                            
                            // Reset the attempts tracking
                            player.attemptedTracksSet.set(guildId, new Set());
                            return;
                        }
                        
                        // Try the last track if available
                        if (fallbackTracks.length > 0) {
                            const lastTrack = fallbackTracks[0];
                            
                            // Mark that we attempted this track
                            if (lastTrack && lastTrack.url) {
                                player.attemptedTracksSet.get(guildId).add(lastTrack.url);
                            }
                            
                            await interaction.channel.send({ 
                                content: `❌ | Second track failed too. Trying alternative (3/3): **${lastTrack.title}**` 
                            });
                            
                            try {
                                // Mark the track as the fallback
                                lastTrack._fallbackAttempt = true;
                                lastTrack._fallbackAttemptNumber = 3;
                                
                                const lastResult = await player.play(
                                    interaction.member.voice.channel,
                                    lastTrack,
                                    { nodeOptions }
                                );
                                
                                if (lastResult && lastResult.track) {
                                    await interaction.channel.send({ 
                                        content: `🎶 | Now playing last alternative: **${lastResult.track.title}**` 
                                    });
                                }
                            } catch (lastError) {
                                console.error(`Error playing last track: ${lastError.message}`);
                                
                                // Check if we're hitting the maximum attempts limit
                                const attemptCount = player.attemptedTracksSet.get(guildId).size;
                                if (attemptCount >= 5) {
                                    await interaction.channel.send({ 
                                        content: `❌ | I've tried ${attemptCount} different tracks, but they all have YouTube restrictions. Please try a completely different song or artist.` 
                                    });
                                    
                                    // Reset the attempts tracking
                                    player.attemptedTracksSet.set(guildId, new Set());
                                    return;
                                }
                                
                                // If this was a direct link, try searching by title as a last resort
                                if (isDirectLink && topTracks[0]) {
                                    await interaction.channel.send({ 
                                        content: `🔍 | Searching for tracks with title: **${topTracks[0].title}**` 
                                    });
                                    
                                    try {
                                        const titleSearch = await player.search(topTracks[0].title, { requestedBy: interaction.user });
                                        
                                        if (titleSearch && titleSearch.tracks.length > 0) {
                                            // Filter out tracks we've already tried
                                            const filteredTracks = titleSearch.tracks
                                                .filter(t => !player.attemptedTracksSet.get(guildId).has(t.url))
                                                .slice(0, 1); // Get only the first untried track
                                                
                                            if (filteredTracks.length > 0) {
                                                const altTrack = filteredTracks[0];
                                                altTrack._fallbackAttempt = true;
                                                
                                                // Mark that we attempted this track
                                                if (altTrack && altTrack.url) {
                                                    player.attemptedTracksSet.get(guildId).add(altTrack.url);
                                                }
                                                
                                                await interaction.channel.send({ 
                                                    content: `▶️ | Found track by title search: **${altTrack.title}**` 
                                                });
                                                
                                                const altResult = await player.play(
                                                    interaction.member.voice.channel,
                                                    altTrack,
                                                    { nodeOptions }
                                                );
                                                
                                                if (altResult && altResult.track) {
                                                    await interaction.channel.send({ 
                                                        content: `🎶 | Now playing: **${altResult.track.title}**` 
                                                    });
                                                }
                                            } else {
                                                await interaction.channel.send({ 
                                                    content: `❌ | All attempts failed. I've tried ${player.attemptedTracksSet.get(guildId).size} tracks but they all have YouTube restrictions. Please try a completely different song or artist.` 
                                                });
                                                
                                                // Reset tracking
                                                player.attemptedTracksSet.set(guildId, new Set());
                                            }
                                        } else {
                                            await interaction.channel.send({ 
                                                content: `❌ | All attempts failed. Please try a different search query.` 
                                            });
                                            
                                            // Reset tracking
                                            player.attemptedTracksSet.set(guildId, new Set());
                                        }
                                    } catch (titleError) {
                                        console.error(`Error with title search: ${titleError.message}`);
                                        await interaction.channel.send({ 
                                            content: `❌ | All attempts failed. Please try a different search query.` 
                                        });
                                        
                                        // Reset tracking
                                        player.attemptedTracksSet.set(guildId, new Set());
                                    }
                                } else {
                                    await interaction.channel.send({ 
                                        content: `❌ | All tracks failed. Please try a different search query.` 
                                    });
                                    
                                    // Reset tracking
                                    player.attemptedTracksSet.set(guildId, new Set());
                                }
                            }
                        } else if (isDirectLink && topTracks[0]) {
                            // For direct links, try searching by title as a fallback
                            await interaction.channel.send({ 
                                content: `🔍 | Searching for tracks with title: **${topTracks[0].title}**` 
                            });
                            
                            try {
                                const titleSearch = await player.search(topTracks[0].title, { requestedBy: interaction.user });
                                
                                if (titleSearch && titleSearch.tracks.length > 0) {
                                    // Filter out tracks we've already tried
                                    const filteredTracks = titleSearch.tracks
                                        .filter(t => !player.attemptedTracksSet.get(guildId).has(t.url))
                                        .slice(0, 1); // Get only the first untried track
                                        
                                    if (filteredTracks.length > 0) {
                                        const altTrack = filteredTracks[0];
                                        altTrack._fallbackAttempt = true;
                                        
                                        // Mark that we attempted this track
                                        if (altTrack && altTrack.url) {
                                            player.attemptedTracksSet.get(guildId).add(altTrack.url);
                                        }
                                        
                                        await interaction.channel.send({ 
                                            content: `▶️ | Found track by title search: **${altTrack.title}**` 
                                        });
                                        
                                        const altResult = await player.play(
                                            interaction.member.voice.channel,
                                            altTrack,
                                            { nodeOptions }
                                        );
                                        
                                        if (altResult && altResult.track) {
                                            await interaction.channel.send({ 
                                                content: `🎶 | Now playing: **${altResult.track.title}**` 
                                            });
                                        }
                                    } else {
                                        await interaction.channel.send({ 
                                            content: `❌ | All attempts failed. I've tried ${player.attemptedTracksSet.get(guildId).size} tracks but they all have YouTube restrictions. Please try a completely different song or artist.` 
                                        });
                                        
                                        // Reset tracking
                                        player.attemptedTracksSet.set(guildId, new Set());
                                    }
                                } else {
                                    await interaction.channel.send({ 
                                        content: `❌ | Could not find any alternative tracks. Please try a different search query.` 
                                    });
                                    
                                    // Reset tracking
                                    player.attemptedTracksSet.set(guildId, new Set());
                                }
                            } catch (titleError) {
                                console.error(`Error with title search: ${titleError.message}`);
                                await interaction.channel.send({ 
                                    content: `❌ | All attempts failed. Please try a different search query.` 
                                });
                                
                                // Reset tracking
                                player.attemptedTracksSet.set(guildId, new Set());
                            }
                        }
                    }
                } else if (isDirectLink && topTracks[0]) {
                    // For direct links with no fallbacks, try searching by title immediately
                    await interaction.channel.send({ 
                        content: `🔍 | Direct link failed. Searching for tracks with title: **${topTracks[0].title}**` 
                    });
                    
                    try {
                        const titleSearch = await player.search(topTracks[0].title, { requestedBy: interaction.user });
                        
                        if (titleSearch && titleSearch.tracks.length > 0) {
                            // Filter out tracks we've already tried
                            const filteredTracks = titleSearch.tracks
                                .filter(t => !player.attemptedTracksSet.get(guildId).has(t.url))
                                .slice(0, 1); // Get only the first untried track
                                
                            if (filteredTracks.length > 0) {
                                const altTrack = filteredTracks[0];
                                altTrack._fallbackAttempt = true;
                                
                                // Mark that we attempted this track
                                if (altTrack && altTrack.url) {
                                    player.attemptedTracksSet.get(guildId).add(altTrack.url);
                                }
                                
                                await interaction.channel.send({ 
                                    content: `▶️ | Found track by title search: **${altTrack.title}**` 
                                });
                                
                                const altResult = await player.play(
                                    interaction.member.voice.channel,
                                    altTrack,
                                    { nodeOptions }
                                );
                                
                                if (altResult && altResult.track) {
                                    await interaction.channel.send({ 
                                        content: `🎶 | Now playing: **${altResult.track.title}**` 
                                    });
                                }
                            } else {
                                await interaction.channel.send({ 
                                    content: `❌ | I've tried ${player.attemptedTracksSet.get(guildId).size} tracks but they all have YouTube restrictions. Please try a completely different song or artist.` 
                                });
                                
                                // Reset tracking
                                player.attemptedTracksSet.set(guildId, new Set());
                            }
                        } else {
                            await interaction.channel.send({ 
                                content: `❌ | Could not find any alternative tracks. Please try a different search query.` 
                            });
                            
                            // Reset tracking
                            player.attemptedTracksSet.set(guildId, new Set());
                        }
                    } catch (titleError) {
                        console.error(`Error with title search: ${titleError.message}`);
                        await interaction.channel.send({ 
                            content: `❌ | All attempts failed. Please try a different search query.` 
                        });
                        
                        // Reset tracking
                        player.attemptedTracksSet.set(guildId, new Set());
                    }
                }
            }
            
        } catch (error) {
            console.error("Error in play command:", error);
            
            // Reset tracking in case of errors
            const guildId = interaction.guild.id;
            if (player.attemptedTracksSet && player.attemptedTracksSet.has(guildId)) {
                player.attemptedTracksSet.set(guildId, new Set());
            }
            
            // Check if it's a YouTube extraction error
            if (error.message && (
                error.message.includes("Could not extract stream") || 
                error.message.includes("Status code: 410") || 
                error.message.includes("Status code: 403")
            )) {
                return interaction.followUp({ 
                    content: "❌ | Could not play any of the top results due to YouTube restrictions. Try searching for a lyrics or audio version instead."
                });
            }
            
            return interaction.followUp({ 
                content: `There was an error while executing this command: ${error}`
            });
        }
    }
};