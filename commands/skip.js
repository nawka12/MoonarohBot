module.exports = {
    name: 'skip',
    description: 'Skip to the next song in the queue',
    async execute(interaction, player) {
        await interaction.deferReply();
        const queue = player.nodes.get(interaction.guildId);
        if (!queue || !queue.isPlaying())
            return interaction.followUp({ content: "❌ | No music is being played!" });
        
        const currentTrack = queue.currentTrack;
        const success = queue.node.skip();
        return interaction.followUp({
            content: success ? `✅ | Skipped **${currentTrack.title}**!` : "❌ | Something went wrong!"
        });
    }
};