const { EmbedBuilder } = require('discord.js');

function createProgressBar(current, total, barSize = 20) {
    const progress = Math.round((current / total) * barSize);
    const emptyProgress = barSize - progress;

    const progressText = '▇'.repeat(progress);
    const emptyProgressText = '—'.repeat(emptyProgress);

    return `[${progressText}${emptyProgressText}]`;
}

module.exports = {
    name: 'nowplaying',
    description: 'Shows information about the currently playing song',
    async execute(interaction, player) {
        const queue = player.nodes.get(interaction.guildId);
        if (!queue || !queue.isPlaying()) {
            return interaction.reply({ content: "❌ | No music is being played!", ephemeral: true });
        }
    
        const progress = queue.node.getTimestamp();
        const track = queue.currentTrack;
    
        const embed = new EmbedBuilder()
            .setTitle('Now Playing')
            .setDescription(`🎶 | **${track.title}**`)
            .setThumbnail(track.thumbnail)
            .addFields(
                { name: 'Duration', value: `\`${progress.current.label} / ${track.duration}\``, inline: true },
                { name: 'Author', value: track.author, inline: true },
                { name: 'Requested by', value: `${track.requestedBy}`, inline: true }
            )
            .setFooter({ text: createProgressBar(progress.current.value, track.durationMS) });
    
        return interaction.reply({ embeds: [embed] });
    }
};