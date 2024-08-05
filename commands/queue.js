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
    
        let response = `**Currently Playing:**\n${currentTrack.title}\n\n`;
    
        if (tracks.length) {
            response += `**Queue:**\n${tracks.map((track, i) => `${i + 1}. ${track.title}`).join("\n")}`;
        }
    
        return interaction.reply({ content: response });
    }
};