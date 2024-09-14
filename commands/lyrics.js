// filename: lyrics.js
const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'lyrics',
    description: 'Get lyrics for the current song or a specified song',
    options: [
        {
            name: 'song',
            type: 3, // STRING type
            description: 'The name of the song to search lyrics for (optional)',
            required: false
        }
    ],
    async execute(interaction, player) {
        await interaction.deferReply();

        const queue = player.nodes.get(interaction.guildId);
        let songQuery = interaction.options.getString('song');

        if (!songQuery) {
            if (!queue || !queue.isPlaying()) {
                return interaction.followUp({ content: 'No music is being played and no song was specified.', ephemeral: true });
            }
            songQuery = queue.currentTrack.title;
        }

        try {
            const lyrics = await player.lyrics.search({
                q: songQuery
            });

            if (!lyrics || !lyrics.length) {
                return interaction.followUp({ content: 'No lyrics found', ephemeral: true });
            }

            const lyricsData = lyrics[0];

            if (!lyricsData || !lyricsData.plainLyrics) {
                return interaction.followUp({ content: 'Lyrics data is incomplete', ephemeral: true });
            }

            const baseEmbed = new EmbedBuilder()
                .setColor('Purple');

            if (lyricsData.title) baseEmbed.setTitle(lyricsData.title);
            if (lyricsData.url) baseEmbed.setURL(lyricsData.url);
            if (lyricsData.thumbnail) baseEmbed.setThumbnail(lyricsData.thumbnail);

            if (lyricsData.artist) {
                const authorData = {
                    name: lyricsData.artist.name || 'Unknown Artist'
                };
                if (lyricsData.artist.image) authorData.iconURL = lyricsData.artist.image;
                if (lyricsData.artist.url) authorData.url = lyricsData.artist.url;
                baseEmbed.setAuthor(authorData);
            }

            // Split lyrics into chunks of 4096 characters or less (Discord's embed description limit)
            const lyricsChunks = splitLyrics(lyricsData.plainLyrics);

            // Send embeds for each chunk
            for (let i = 0; i < lyricsChunks.length; i++) {
                const embed = new EmbedBuilder(baseEmbed.toJSON())
                    .setDescription(lyricsChunks[i]);
                
                if (i === 0) {
                    // First embed
                    await interaction.followUp({ embeds: [embed] });
                } else {
                    // Subsequent embeds
                    embed.setTitle(`${lyricsData.title} (continued)`);
                    await interaction.followUp({ embeds: [embed] });
                }
            }

        } catch (error) {
            console.error("Error fetching lyrics:", error);
            return interaction.followUp({ content: "An error occurred while fetching lyrics.", ephemeral: true });
        }
    }
};

function splitLyrics(lyrics) {
    const chunks = [];
    let currentChunk = '';

    lyrics.split('\n').forEach(line => {
        if (currentChunk.length + line.length + 1 > 4096) {
            chunks.push(currentChunk);
            currentChunk = line;
        } else {
            currentChunk += (currentChunk ? '\n' : '') + line;
        }
    });

    if (currentChunk) {
        chunks.push(currentChunk);
    }

    return chunks;
}
