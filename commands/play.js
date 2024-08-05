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
        const searchResult = await player.search(query, { requestedBy: interaction.user }).catch(() => {});
        if (!searchResult || !searchResult.tracks.length)
            return interaction.followUp({ content: "No results were found!" });

        try {
            const { track } = await player.play(interaction.member.voice.channel, searchResult, {
                nodeOptions: {
                    metadata: interaction.channel
                }
            });

            return interaction.followUp({ content: `⏱ | Loading track **${track.title}**!` });
        } catch (error) {
            console.error("Error in play command:", error);
            return interaction.followUp({ content: `There was an error while executing this command: ${error}` });
        }
    }
};