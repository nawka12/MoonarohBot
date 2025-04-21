# MoonarohBot
Discord music bot using discord-player and discord-player-youtubei extractor.

## Features
- Play music from multiple sources:
  - YouTube (search or direct links)
  - Spotify links (extracts and searches YouTube automatically)
  - Apple Music links (extracts and searches YouTube automatically)  
  - SoundCloud links (direct streaming supported)
- Queue management with detailed track information
- Display current song information with "nowplaying" command
- Skip to next track in queue
- Remove specific songs from the queue
- Stop playback and clear the queue
- Loop/repeat mode for continuous playback
- Fetch and display lyrics for the current song or any specified song
- Smart fallback system for handling unavailable tracks
- High quality audio playback settings

## Commands
- `/play <query>` - Play music from YouTube, Spotify, Apple Music, or SoundCloud
- `/queue` - Display the current music queue with track information
- `/nowplaying` - Show details about the currently playing track
- `/skip` - Skip to the next track in the queue
- `/remove <position>` - Remove a specific track from the queue
- `/stop` - Stop playback and clear the queue
- `/loop` - Toggle loop/repeat mode for continuous playback
- `/lyrics [song]` - Get lyrics for the current song or a specified song
- `/attachment` - Handle attachment-based music playback

## Current Status
- **Active Development**: The bot is fully functional with all core music playback features implemented
- **Node.js Version**: Requires Node.js 20+
- **Discord.js**: Using discord.js v14
- **Music Playback**: Powered by discord-player v7 with YouTube extractor
- **Dependencies**: All external libraries are up-to-date

## Requirements
- Node.js 20 or up
- NPM

## Installation
```bash
git clone https://github.com/nawka12/MoonarohBot
cd MoonarohBot
npm install
```

## Configuration
Create a `.env` file in the root directory and add your Discord bot token:
```
TOKEN=your_discord_bot_token_here
```

You can also customize the bot's activity status in `config.json`.

## Running the Bot
```bash
# Run directly with Node.js
npm start

# Development mode with auto-restart
npm run dev

# OR use PM2 for production (recommended)
npm install -g pm2
pm2 start index.js
```
