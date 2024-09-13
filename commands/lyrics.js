// filename: lyrics.js
const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'lyrics',
    description: 'Get lyrics for a song',
    options: [
        {
            name: 'song',
            type: 3, // STRING type
            description: 'The name of the song to search lyrics for',
            required: true
        }
    ],
    async execute(interaction, player) {
        await interaction.deferReply();

        const songQuery = interaction.options.getString('song');

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

            const trimmedLyrics = lyricsData.plainLyrics.substring(0, 1997);

            const embed = new EmbedBuilder()
                .setColor('Yellow');

            if (lyricsData.title) embed.setTitle(lyricsData.title);
            if (lyricsData.url) embed.setURL(lyricsData.url);
            if (lyricsData.thumbnail) embed.setThumbnail(lyricsData.thumbnail);

            if (lyricsData.artist) {
                const authorData = {
                    name: lyricsData.artist.name || 'Unknown Artist'
                };
                if (lyricsData.artist.image) authorData.iconURL = lyricsData.artist.image;
                if (lyricsData.artist.url) authorData.url = lyricsData.artist.url;
                embed.setAuthor(authorData);
            }

            embed.setDescription(trimmedLyrics.length === 1997 ? `${trimmedLyrics}...` : trimmedLyrics);

            return interaction.followUp({ embeds: [embed] });
        } catch (error) {
            console.error("Error fetching lyrics:", error);
            return interaction.followUp({ content: "An error occurred while fetching lyrics.", ephemeral: true });
        }
    }
};
