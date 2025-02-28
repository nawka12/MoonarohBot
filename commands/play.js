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
        let actualQuery = query;
        let isExternalSource = false;
        let canStreamDirectly = false;
        
        // Handle external music service links (Spotify, Apple Music, SoundCloud)
        if (query.includes('spotify.com') || query.includes('music.apple.com') || query.includes('soundcloud.com')) {
            isExternalSource = true;
            
            // Step 1: Use official extractors to get metadata
            if (query.includes('spotify.com')) {
                await interaction.followUp({ content: `🔍 | Detected Spotify link, extracting song information...` });
                console.log(`Using extractors for Spotify URL: ${query}`);
            } else if (query.includes('music.apple.com')) {
                await interaction.followUp({ content: `🔍 | Detected Apple Music link, extracting song information...` });
                console.log(`Using extractors for Apple Music URL: ${query}`);
            } else if (query.includes('soundcloud.com')) {
                await interaction.followUp({ content: `🔍 | Detected SoundCloud link, extracting song information...` });
                console.log(`Using extractors for SoundCloud URL: ${query}`);
                // SoundCloud extractor supports direct streaming
                canStreamDirectly = true;
            }
            
            // Use extractors to get track info
            const externalResult = await player.search(query, { 
                requestedBy: interaction.user
            }).catch((error) => {
                console.error("External source extraction error:", error);
                return null;
            });
            
            // If we found a track...
            if (externalResult && externalResult.tracks.length > 0) {
                const extractedTrack = externalResult.tracks[0];
                
                // For SoundCloud tracks
                if (canStreamDirectly && query.includes('soundcloud.com')) {
                    await interaction.followUp({ 
                        content: `✅ | Found track: "${extractedTrack.title}"\n▶️ | Loading track...` 
                    });
                    
                    console.log(`Playing track from URL: "${extractedTrack.title}"`);
                    
                    // Mark all tracks in this result as direct SoundCloud streams
                    externalResult.tracks.forEach(track => {
                        track._isDirectStream = true;
                        track._fromExternalSource = true;
                        track._originalQuery = query;
                        track._isSoundCloud = true;
                    });
                    
                    // Process the result directly without YouTube search
                    return this.processSearchResult(interaction, player, externalResult, query, query, isExternalSource, true);
                }
                // For services that don't support streaming (Spotify, Apple Music)
                else {
                    actualQuery = extractedTrack.title;
                    
                    if (extractedTrack.author) {
                        actualQuery = `${extractedTrack.author} ${extractedTrack.title}`;
                    }
                    
                    await interaction.followUp({ 
                        content: `✅ | Found track: "${extractedTrack.title}"\n🔍 | Searching for best match...` 
                    });
                    
                    console.log(`Extracted track info: "${actualQuery}", now searching YouTube`);
                }
            } else {
                // Only show failure message if track extraction actually failed
                // This was showing up even when SoundCloud extraction succeeded
                if (!canStreamDirectly || !externalResult) {
                    await interaction.followUp({ 
                        content: `❌ | Couldn't extract track info from URL. Trying to use URL directly...` 
                    });
                }
            }
            
            // Step 2: If we got track info and need YouTube (for Spotify/Apple), search YouTube with it
            if (actualQuery !== query && !canStreamDirectly) {
                // Use the YouTubei extractor with the song title
                const searchResult = await player.search(actualQuery, { 
                    requestedBy: interaction.user
                }).catch((error) => {
                    console.error("YouTube search error:", error);
                    return null;
                });
                
                // If we found YouTube results, proceed with them
                if (searchResult && searchResult.tracks.length > 0) {
                    console.log(`Found ${searchResult.tracks.length} YouTube results for "${actualQuery}"`);
                    // Continue with these search results
                    return this.processSearchResult(interaction, player, searchResult, query, actualQuery, isExternalSource, false);
                } else {
                    return interaction.followUp({ content: `❌ | Couldn't find any YouTube matches for "${actualQuery}"` });
                }
            }
        }
        
        // Regular search for non-external sources or fallback if extraction failed
        const searchResult = await player.search(actualQuery, { 
            requestedBy: interaction.user
        }).catch((error) => {
            console.error("Search error:", error);
            return null;
        });
        
        if (!searchResult || !searchResult.tracks.length)
            return interaction.followUp({ content: "No results were found!" });
            
        // Process the search results
        return this.processSearchResult(interaction, player, searchResult, query, actualQuery, isExternalSource, false);
    },
    
    // Helper method to process search results and play tracks
    async processSearchResult(interaction, player, searchResult, originalQuery, actualQuery, isExternalSource, isDirectStreamSource) {
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
            
            // Double-check if this is a SoundCloud track based on the original query
            // This ensures we tag SoundCloud tracks correctly even if the flags weren't set earlier
            if (originalQuery.includes('soundcloud.com')) {
                console.log('Double-checking SoundCloud track tagging');
                
                // Ensure all tracks from SoundCloud are properly tagged
                topTracks.forEach(track => {
                    track._fromExternalSource = true;
                    track._originalQuery = originalQuery;
                    track._isSoundCloud = true;
                    
                    // Mark as direct stream if that flag was passed
                    if (isDirectStreamSource) {
                        track._isDirectStream = true;
                    }
                });
                
                // Force these flags for consistency
                isExternalSource = true;
                
                console.log(`Tagged ${topTracks.length} tracks as SoundCloud tracks`);
            }
            
            // Debug the tracks found
            console.log(`Found ${topTracks.length} tracks for "${actualQuery}":`);
            topTracks.forEach((t, i) => {
                console.log(`${i+1}. ${t.title} (${t.url}) - Duration: ${t.duration}`);
            });
            
            // Check if this is a direct YouTube link (will have only one result)
            const isDirectLink = originalQuery.includes('youtube.com/watch?v=') || originalQuery.includes('youtu.be/');
            
            // Send acknowledgment with appropriate message
            if (isExternalSource) {
                // Direct streaming source like SoundCloud
                if (isDirectStreamSource) {
                    // Check if any track is marked as SoundCloud
                    const isSoundCloud = topTracks.length > 0 && topTracks[0]._isSoundCloud;
                    
                    console.log(`Processing direct stream source. isSoundCloud: ${isSoundCloud}, originalQuery: ${originalQuery}`);
                    console.log(`Track flags: _isSoundCloud=${topTracks[0]._isSoundCloud}, _isDirectStream=${topTracks[0]._isDirectStream}, _fromExternalSource=${topTracks[0]._fromExternalSource}`);
                    
                    await interaction.followUp({ 
                        content: `⏱ | Loading track: **${topTracks[0].title}**` 
                    });
                }
                // External source requiring YouTube (Spotify, Apple Music)
                else {
                    // Check if the original query is from SoundCloud even though it's not marked as direct stream
                    // This is a fallback in case the direct stream flag isn't properly set
                    if (originalQuery.includes('soundcloud.com')) {
                        console.log(`SoundCloud URL detected but not marked as direct stream.`);
                        console.log(`Track flags: _isSoundCloud=${topTracks[0]._isSoundCloud}, _isDirectStream=${topTracks[0]._isDirectStream}, _fromExternalSource=${topTracks[0]._fromExternalSource}`);
                        
                        await interaction.followUp({ 
                            content: `⏱ | Loading track: **${topTracks[0].title}**` 
                        });
                    } else {
                        await interaction.followUp({ 
                            content: `⏱ | Found ${topTracks.length} matches for "${actualQuery}".\nPlaying the best match.` 
                        });
                    }
                }
            } else if (isDirectLink) {
                await interaction.followUp({ 
                    content: `⏱ | Loading track from URL: **${originalQuery}**\nIf it fails, I'll try searching by title.` 
                });
            } else {
                await interaction.followUp({ 
                    content: `⏱ | Searching for: **${originalQuery}**\nFound ${topTracks.length} results, will try alternative tracks if the first one fails.` 
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

            // Create a safer wrapper for player.play
            const safePlay = async (voiceChannel, track, options) => {
                try {
                    return await player.play(voiceChannel, track, options);
                } catch (error) {
                    console.error(`Safe play wrapper caught error: ${error.message}`);
                    
                    // Check if this is a YouTube download error
                    if (error.message.includes("Downloading of") || 
                        error.message.includes("download failed") ||
                        error.message.includes("Could not extract stream") || 
                        error.message.includes("Status code: 410") || 
                        error.message.includes("Status code: 403")) {
                        
                        // Create a more specific error that we already handle
                        const enhancedError = new Error(`Could not download YouTube track: ${error.message}`);
                        throw enhancedError;
                    }
                    
                    // Rethrow other errors
                    throw error;
                }
            };
            
            // Add a handler to catch download errors early
            const handleTrackError = async (track, errorMessage, attemptNumber = 1) => {
                console.log(`Track error handler called: ${errorMessage} (attempt: ${attemptNumber})`);
                
                // Check if it's a download error
                const isDownloadError = errorMessage.includes("Downloading of") || 
                                       errorMessage.includes("download failed") ||
                                       errorMessage.includes("Could not extract stream") || 
                                       errorMessage.includes("Status code: 410") || 
                                       errorMessage.includes("Status code: 403");
                
                if (isDownloadError && player.fallbackTracksMap.has(guildId)) {
                    const fallbackTracks = player.fallbackTracksMap.get(guildId);
                    if (fallbackTracks.length > 0) {
                        const fallbackTrack = fallbackTracks.shift();
                        
                        // Mark that we attempted this track
                        if (fallbackTrack && fallbackTrack.url) {
                            player.attemptedTracksSet.get(guildId).add(fallbackTrack.url);
                        }
                        
                        await interaction.channel.send({ 
                            content: `❌ | Error downloading track. Trying alternative (${attemptNumber+1}/3): **${fallbackTrack.title}**` 
                        });
                        
                        try {
                            fallbackTrack._fallbackAttempt = true;
                            fallbackTrack._fallbackAttemptNumber = attemptNumber + 1;
                            
                            const nodeOptions = {
                                metadata: interaction.channel,
                                leaveOnEmpty: true,
                                leaveOnEmptyCooldown: 1000, // 1 second delay before leaving
                                leaveOnEnd: true,
                                leaveOnEndCooldown: 30000, // 30 second delay before leaving
                            };
                            
                            // Use the safer play method
                            const result = await safePlay(
                                interaction.member.voice.channel,
                                fallbackTrack,
                                { nodeOptions }
                            );
                            
                            return result;
                        } catch (nextError) {
                            // If we're at the last attempt, give up
                            if (attemptNumber >= 2 || fallbackTracks.length === 0) {
                                await interaction.channel.send({ 
                                    content: `❌ | All alternatives failed. Please try a different search query.` 
                                });
                                return null;
                            }
                            
                            // Try the next track
                            return handleTrackError(fallbackTrack, nextError.message, attemptNumber + 1);
                        }
                    }
                }
                
                // If we get here, either it's not a download error or we have no fallbacks
                return null;
            };

            // Play the first track
            try {
                const result = await safePlay(interaction.member.voice.channel, topTracks[0], {
                    nodeOptions: {
                        metadata: interaction.channel,
                        leaveOnEmpty: true,
                        leaveOnEmptyCooldown: 1000, // 1 second delay before leaving
                        leaveOnEnd: true,
                        leaveOnEndCooldown: 30000, // 30 second delay before leaving
                    },
                    // Add enhanced error handling
                    onError: (error) => {
                        console.error(`Error in player.play handler: ${error.message}`);
                        // Will be handled by the try/catch
                        throw error;
                    }
                });
                
                console.log(`Play result: ${result ? "success" : "failed"}`);
                
                // We'll let the playerStart event handle the "Now playing" message
                // This prevents duplicate messages when fallbacks are used
                
                // Store information that we've started this track
                if (result && result.track) {
                    // Add a property to track that this was the initial track
                    result.track._initialTrack = true;
                    
                    // If this was from an external source, add that info
                    if (isExternalSource) {
                        result.track._fromExternalSource = true;
                        result.track._originalQuery = originalQuery;
                        
                        // Add information about direct streaming
                        if (isDirectStreamSource) {
                            result.track._isDirectStream = true;
                        }
                    }
                }
            } catch (playError) {
                // Check if this is a YouTube download error
                const isYouTubeDownloadError = playError.message && (
                    playError.message.includes("Downloading of") ||
                    playError.message.includes("download failed") ||
                    playError.message.includes("Could not extract stream") || 
                    playError.message.includes("Status code: 410") || 
                    playError.message.includes("Status code: 403")
                );
                
                console.error(`Error playing first track: ${playError.message}`);
                console.log(`Is YouTube download error: ${isYouTubeDownloadError}`);
                
                // Try to use our handler to recover
                if (isYouTubeDownloadError) {
                    const recoveryResult = await handleTrackError(topTracks[0], playError.message);
                    if (recoveryResult) {
                        // Success! We recovered using the handler
                        return;
                    }
                }
                
                // If we get here, either it's not a download error or the handler couldn't recover
                // Continue with existing error handling...
                
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
                    
                    // Custom message for YouTube download errors
                    if (isYouTubeDownloadError) {
                        await interaction.channel.send({ 
                            content: `❌ | Could not download the track due to YouTube restrictions. Trying alternative (2/3): **${fallbackTrack.title}**` 
                        });
                    } else {
                        await interaction.channel.send({ 
                            content: `❌ | First track failed immediately. Trying alternative (2/3): **${fallbackTrack.title}**` 
                        });
                    }
                    
                    try {
                        const fallbackResult = await safePlay(
                            interaction.member.voice.channel,
                            fallbackTrack,
                            { nodeOptions: {
                                metadata: interaction.channel,
                                leaveOnEmpty: true,
                                leaveOnEmptyCooldown: 1000, // 1 second delay before leaving
                                leaveOnEnd: true,
                                leaveOnEndCooldown: 30000, // 30 second delay before leaving
                            } }
                        );
                        
                        if (fallbackResult && fallbackResult.track) {
                            // Mark this as a fallback track
                            fallbackResult.track._fallbackAttempt = true;
                            fallbackResult.track._fallbackAttemptNumber = 2;
                            
                            // We'll let the playerStart event handle the success message
                        }
                    } catch (fallbackError) {
                        const isFallbackDownloadError = fallbackError.message && (
                            fallbackError.message.includes("Downloading of") ||
                            fallbackError.message.includes("download failed") ||
                            fallbackError.message.includes("Could not extract stream") || 
                            fallbackError.message.includes("Status code: 410") || 
                            fallbackError.message.includes("Status code: 403")
                        );
                        
                        console.error(`Error playing fallback track: ${fallbackError.message}`);
                        console.log(`Is fallback YouTube download error: ${isFallbackDownloadError}`);
                        
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
                            
                            // Custom message for YouTube download errors
                            if (isFallbackDownloadError) {
                                await interaction.channel.send({ 
                                    content: `❌ | Could not download the second track due to YouTube restrictions. Trying final alternative (3/3): **${lastTrack.title}**` 
                                });
                            } else {
                                await interaction.channel.send({ 
                                    content: `❌ | Second track failed too. Trying alternative (3/3): **${lastTrack.title}**` 
                                });
                            }
                            
                            try {
                                // Mark the track as the fallback
                                lastTrack._fallbackAttempt = true;
                                lastTrack._fallbackAttemptNumber = 3;
                                
                                const lastResult = await safePlay(
                                    interaction.member.voice.channel,
                                    lastTrack,
                                    { nodeOptions: {
                                        metadata: interaction.channel,
                                        leaveOnEmpty: true,
                                        leaveOnEmptyCooldown: 1000, // 1 second delay before leaving
                                        leaveOnEnd: true,
                                        leaveOnEndCooldown: 30000, // 30 second delay before leaving
                                    } }
                                );
                                
                                if (lastResult && lastResult.track) {
                                    // We'll let the playerStart event handle the success message
                                    lastResult.track._fallbackAttempt = true;
                                    lastResult.track._fallbackAttemptNumber = 3;
                                }
                            } catch (lastError) {
                                const isLastDownloadError = lastError.message && (
                                    lastError.message.includes("Downloading of") ||
                                    lastError.message.includes("download failed") ||
                                    lastError.message.includes("Could not extract stream") || 
                                    lastError.message.includes("Status code: 410") || 
                                    lastError.message.includes("Status code: 403")
                                );
                                
                                console.error(`Error playing last track: ${lastError.message}`);
                                console.log(`Is last track YouTube download error: ${isLastDownloadError}`);
                                
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
                                                
                                                const altResult = await safePlay(
                                                    interaction.member.voice.channel,
                                                    altTrack,
                                                    { nodeOptions: {
                                                        metadata: interaction.channel,
                                                        leaveOnEmpty: true,
                                                        leaveOnEmptyCooldown: 1000, // 1 second delay before leaving
                                                        leaveOnEnd: true,
                                                        leaveOnEndCooldown: 30000, // 30 second delay before leaving
                                                    } }
                                                );
                                                
                                                if (altResult && altResult.track) {
                                                    // We'll let the playerStart event handle the success message
                                                    altResult.track._fallbackAttempt = true;
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
                                    // Custom message for YouTube download errors
                                    if (isLastDownloadError) {
                                        await interaction.channel.send({ 
                                            content: `❌ | All tracks failed due to YouTube download restrictions. Please try a different song or artist.` 
                                        });
                                    } else {
                                        await interaction.channel.send({ 
                                            content: `❌ | All tracks failed. Please try a different search query.` 
                                        });
                                    }
                                    
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
                                        
                                        const altResult = await safePlay(
                                            interaction.member.voice.channel,
                                            altTrack,
                                            { nodeOptions: {
                                                metadata: interaction.channel,
                                                leaveOnEmpty: true,
                                                leaveOnEmptyCooldown: 1000, // 1 second delay before leaving
                                                leaveOnEnd: true,
                                                leaveOnEndCooldown: 30000, // 30 second delay before leaving
                                            } }
                                        );
                                        
                                        if (altResult && altResult.track) {
                                            // We'll let the playerStart event handle the success message
                                            altResult.track._fallbackAttempt = true;
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
                                
                                const altResult = await safePlay(
                                    interaction.member.voice.channel,
                                    altTrack,
                                    { nodeOptions: {
                                        metadata: interaction.channel,
                                        leaveOnEmpty: true,
                                        leaveOnEmptyCooldown: 1000, // 1 second delay before leaving
                                        leaveOnEnd: true,
                                        leaveOnEndCooldown: 30000, // 30 second delay before leaving
                                    } }
                                );
                                
                                if (altResult && altResult.track) {
                                    // We'll let the playerStart event handle the success message
                                    altResult.track._fallbackAttempt = true;
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
            
            // Check if it's a download error from YouTube
            if (error.message && (
                error.message.includes("Downloading of") ||
                error.message.includes("download failed") ||
                error.message.includes("Could not extract stream") || 
                error.message.includes("Status code: 410") || 
                error.message.includes("Status code: 403")
            )) {
                return interaction.followUp({ 
                    content: "❌ | Could not play any of the tracks due to YouTube download restrictions. Try searching for a lyrics or audio version instead."
                });
            }
            
            return interaction.followUp({ 
                content: `There was an error while executing this command: ${error}`
            });
        }
    }
};