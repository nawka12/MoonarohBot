module.exports = {
    name: 'queue',
    description: 'Shows the current music queue',
    async execute(interaction, player) {
        const queue = player.nodes.get(interaction.guildId);
        if (!queue || !queue.isPlaying()) {
            return interaction.reply({ content: "❌ | No music is being played!", ephemeral: true });
        }
        
        const currentTrack = queue.currentTrack;
        const tracks = queue.tracks.toArray();
        
        // Calculate total duration with safer handling
        const formatDuration = (ms) => {
            // Check if ms is a valid number
            if (ms === undefined || ms === null || isNaN(ms)) {
                return "0:00";
            }
            
            // Handle case where duration is already formatted as MM:SS
            if (typeof ms === 'string' && ms.includes(':')) {
                return ms;
            }
            
            const minutes = Math.floor(ms / 60000);
            const seconds = Math.floor((ms % 60000) / 1000);
            return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
        };
        
        // Helper function to get duration from track - tries multiple properties where duration might be stored
        const getTrackDuration = (track) => {
            // Try different possible locations for duration data
            if (track.duration && !isNaN(track.duration)) {
                return track.duration;
            } else if (track.durationMS && !isNaN(track.durationMS)) {
                return track.durationMS;
            } else if (track.durationInMS && !isNaN(track.durationInMS)) {
                return track.durationInMS;
            } else if (track.length && !isNaN(track.length)) {
                return track.length;
            } else if (track.info && track.info.duration && !isNaN(track.info.duration)) {
                return track.info.duration;
            } else if (track.raw && track.raw.duration && !isNaN(track.raw.duration)) {
                return track.raw.duration;
            }
            
            // For debugging, log what properties are available on the track
            console.log('Track properties:', Object.keys(track).join(', '));
            
            return 0;
        };
        
        // Safely calculate total duration
        const totalDuration = tracks.reduce((acc, track) => {
            return acc + getTrackDuration(track);
        }, getTrackDuration(currentTrack));
        
        // Create an embed for better visual appearance
        const { EmbedBuilder } = require('discord.js');
        const embed = new EmbedBuilder()
            .setTitle('🎵 Music Queue')
            .setColor('#FF0000')
            .setThumbnail(currentTrack.thumbnail || 'https://i.imgur.com/GXLMXCL.png')
            .setDescription(`**Currently Playing:**\n[${currentTrack.title}](${currentTrack.url || ''}) \`${formatDuration(getTrackDuration(currentTrack))}\`\n\n**Up Next:**`)
            .setFooter({ 
                text: `Total Queue: ${tracks.length} songs | Total Duration: ${formatDuration(totalDuration)}`, 
                iconURL: interaction.user.displayAvatarURL({ dynamic: true }) 
            })
            .setTimestamp();
        
        // Handle pagination for large queues
        const tracksPerPage = 10;
        const totalPages = Math.ceil(tracks.length / tracksPerPage);
        const page = 1; // Default to first page
        
        if (tracks.length === 0) {
            embed.addFields({ name: 'Empty Queue', value: 'No songs in queue' });
        } else {
            // Get tracks for current page
            const startIndex = (page - 1) * tracksPerPage;
            const endIndex = Math.min(startIndex + tracksPerPage, tracks.length);
            const currentPageTracks = tracks.slice(startIndex, endIndex);
            
            // Add tracks to embed
            let queueText = '';
            currentPageTracks.forEach((track, i) => {
                const trackUrl = track.url || '';
                queueText += `**${startIndex + i + 1}.** [${track.title}](${trackUrl}) \`${formatDuration(getTrackDuration(track))}\`\n`;
            });
            
            embed.addFields({ name: '\u200b', value: queueText });
            
            if (totalPages > 1) {
                embed.setFooter({ 
                    text: `Page ${page}/${totalPages} | Total: ${tracks.length} songs | Duration: ${formatDuration(totalDuration)}`, 
                    iconURL: interaction.user.displayAvatarURL({ dynamic: true }) 
                });
            }
        }
        
        return interaction.reply({ embeds: [embed] });
    }
};