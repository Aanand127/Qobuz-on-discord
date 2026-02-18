# Qobuz Discord Rich Presence — Show Your Music Activity

Display your currently playing **Qobuz** track as a Discord activity — with album art, Hi-Res Audio badge, and a local web dashboard to control everything.

![Discord Rich Presence Preview](screenshots/discord-preview.png)

## Features

- **Discord Rich Presence** — Displays current track, artist, album, and elapsed time
- **Cross-Platform** — Works on **Windows** and **macOS**
- **Album artwork** — Automatically fetched from iTunes Search API in high resolution (512x512)
- **Web dashboard** — Local web interface with real-time updates via WebSocket
- **Toggle on/off** — Enable or disable the Discord presence from the web UI
- **Customizable** — Change the small icon URL directly from the dashboard
- **Auto-launch** — Opens the web dashboard in your browser on startup

## Screenshots

| Discord Activity | Web Dashboard |
|:---:|:---:|
| ![Discord Activity](screenshots/discord-rpc.png) | ![Web Dashboard](screenshots/web-app.png) |

## Requirements

- [Node.js](https://nodejs.org/) 18 or higher
- [Discord](https://discord.com/) desktop app running
- [Qobuz](https://www.qobuz.com/) desktop app running
- A Discord Application with its Client ID ([create one here](https://discord.com/developers/applications))

## Setup

1. **Clone the repository**

```bash
git clone https://github.com/piodois/qobuz-discord-rpc.git
cd qobuz-discord-rpc
```

2. **Install dependencies**

```bash
npm install
```

3. **Configure environment**

```bash
cp .env.example .env
```

Edit `.env` and set your Discord Client ID:

```env
DISCORD_CLIENT_ID=your_client_id_here
```

4. **Run**

```bash
npm start
```

The web dashboard opens automatically at `http://localhost:3900`.

## Configuration

| Variable | Description | Default |
|---|---|---|
| `DISCORD_CLIENT_ID` | Your Discord Application Client ID | *required* |
| `POLL_INTERVAL_MS` | How often to check Qobuz (ms) | `5000` |
| `WEB_PORT` | Web dashboard port | `3900` |
| `SMALL_IMAGE_URL` | Small icon URL in Rich Presence | `https://i.imgur.com/MgvAj7F.jpeg` |

## How it works

### macOS
- Monitors `~/Library/Application Support/Qobuz/player-0.json` for real-time track changes (including shuffle mode).
- Queries the local Qobuz database (`qobuz.db`) to retrieve track metadata.
  - Checks `S_Track` (streaming tracks) first.
  - Fallbacks to `L_Track` (offline/local tracks) if necessary.

### Windows
- Reads the Qobuz desktop window title via PowerShell to detect the current track.
- Parses the title format: `Song (Album / Year) - Artist`

### Common
- Fetches album artwork from iTunes Search API (cached)
- Updates Discord Rich Presence with track info and artwork
- Broadcasts state to the web dashboard via WebSocket in real time

## Project structure

```
qobuz-discord-rpc/
├── server.js          # Express server + WebSocket + RPC engine
├── public/
│   └── index.html     # Web dashboard (single-file frontend)
├── screenshots/
│   ├── discord-activity.png
│   └── web-app.png
├── .env               # Environment config (not committed)
├── .env.example       # Environment template
└── package.json
```

## License

[MIT](LICENSE)
