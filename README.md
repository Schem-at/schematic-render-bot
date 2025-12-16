# Schemat Render Service

A unified service for rendering Minecraft schematics, featuring:

- 🎨 High-quality schematic rendering via Puppeteer
- 🤖 Discord bot integration
- 🌐 React frontend for web interface
- 🚀 Single container deployment
- ⚡ Optimized with Bun runtime

## Quick Start

```bash
# Install dependencies
bun install

# Setup project
bun run setup-libs

# Configure environment
# Create a .env file with the following variables:
# DISCORD_TOKEN=your_discord_bot_token
# DISCORD_CLIENT_ID=your_discord_application_id (required for slash commands!)
# See DEPLOYMENT.md for full environment variable list

# Add schematic renderer library
# Place schematic-renderer.tar.gz in libs/ directory

# Start development
bun run dev
```

## Architecture

- **Backend**: Express.js + TypeScript + Puppeteer
- **Frontend**: React + Vite + TypeScript
- **Bot**: Discord.js v14
- **Runtime**: Bun for package management and execution
- **Container**: Docker with multi-stage builds

## API Endpoints

- `POST /api/render` - Render schematic file
- `GET /health` - Service health check
- `GET /` - React frontend

## Discord Commands

The bot supports both traditional commands (`!command`) and modern slash commands (`/command`):

### Slash Commands (Recommended)

- `/render` - Render a schematic with custom settings
  - Options: view (perspective/isometric), background color, framing, resolution
- `/video` - Create an animated video of a schematic
  - Options: view, background, duration, framerate
- `/options` - View or modify your default render settings
  - `view` - Show current settings
  - `set` - Update specific settings
  - `reset` - Reset to defaults
- `/help` - Show help information
- `/ping` - Check bot status

### Traditional Commands

- `!render` + attachment - Render image
- `!video` + attachment - Create animation
- `!script` + code - Execute JavaScript to generate schematics
- `!help` - Show help
- `!ping` - Bot status
- `!status` - Check your rate limits
- `!info` - Technical information

### Render Options

- **View Type**: Perspective or Isometric projection
- **Background**: Any hex color (e.g., `#2c3e50`) or `transparent`
- **Framing**: Tight, Medium, or Wide camera distance
- **Resolution**: Custom width and height (256-4096px)
- **Video Settings**: Duration (1-30s) and framerate (15-60fps)

### Quick Re-Render

After uploading a schematic, use the action buttons to instantly re-render with different settings:

- **📐 Isometric** - Toggle between perspective and isometric views
- **📸 Quick Image** - Prompt to upload for image render
- **🎬 Quick Video** - Prompt to upload for video render
- **⚙️ Options** - Open full settings menu

Your last schematic is cached for 30 minutes, allowing instant re-renders without re-uploading!

## Development

```bash
bun run dev          # Start both frontend and backend
bun run dev:backend  # Backend only
bun run dev:frontend # Frontend only
```

## Production

```bash
# Build everything
bun run build

# Run with Docker
docker-compose up --build

# Or run directly
bun start
```

## License

MIT
