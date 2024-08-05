const { QueueRepeatMode } = require("discord-player");

module.exports = {
    name: 'loop',
    description: 'Set loop mode for the queue',
    options: [
        {
            name: 'mode',
            type: 3, // STRING type
            description: 'The loop mode (off, track, queue)',
            required: true,
            choices: [
                { name: 'Off', value: 'off' },
                { name: 'Track', value: 'track' },
                { name: 'Queue', value: 'queue' }
            ]
        }
    ],
    async execute(interaction, player) {
        const queue = player.nodes.get(interaction.guildId);
        if (!queue || !queue.isPlaying()) {
            return interaction.reply({ content: "❌ | No music is being played!", ephemeral: true });
        }
    
        const loopMode = interaction.options.getString("mode");
        let response = "";
    
        switch (loopMode) {
            case "off":
                queue.setRepeatMode(QueueRepeatMode.OFF);
                response = "🔁 | Loop mode is now off.";
                break;
            case "track":
                queue.setRepeatMode(QueueRepeatMode.TRACK);
                response = "🔂 | Now looping the current track.";
                break;
            case "queue":
                queue.setRepeatMode(QueueRepeatMode.QUEUE);
                response = "🔁 | Now looping the entire queue.";
                break;
            default:
                response = "❌ | Invalid loop mode specified.";
        }
    
        return interaction.reply({ content: response });
    }
};