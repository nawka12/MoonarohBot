module.exports = {
    name: 'stop',
    description: 'Stops the music and clears the queue',
    async execute(interaction, player) {
        await interaction.deferReply();
        const queue = player.nodes.get(interaction.guildId);
        if (!queue || !queue.isPlaying())
            return interaction.followUp({ content: "❌ | No music is being played!" });
        
        queue.delete();
        return interaction.followUp({ content: "🛑 | Stopped the player!" });
    }
};