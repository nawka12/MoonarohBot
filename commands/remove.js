module.exports = {
    name: 'remove',
    description: 'Remove a track from the queue by its number',
    options: [
        {
            name: 'number',
            type: 4, // INTEGER type
            description: 'The queue number of the track to remove',
            required: true
        }
    ],
    async execute(interaction, player) {
        const queue = player.nodes.get(interaction.guildId);
        if (!queue || !queue.isPlaying()) {
            return interaction.reply({ content: "❌ | No music is being played!", ephemeral: true });
        }
    
        const trackNum = interaction.options.getInteger("number");
        if (trackNum <= 0 || trackNum > queue.tracks.size) {
            return interaction.reply({ content: "❌ | Invalid track number!", ephemeral: true });
        }
    
        const removedTrack = queue.tracks.toArray()[trackNum - 1];
        queue.removeTrack(trackNum - 1);
    
        return interaction.reply({ content: `🗑️ | Removed track **${removedTrack.title}** from the queue.` });
    }
};