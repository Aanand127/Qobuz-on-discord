// @version 1.0.0
// Qobuz Discord RPC - Web server with real-time UI and RPC engine
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const RPC = require('discord-rpc');
const { execSync } = require('child_process');
const path = require('path');
require('dotenv').config();

// -- Environment configuration --
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS, 10) || 5000;
const WEB_PORT = parseInt(process.env.WEB_PORT, 10) || 3900;

if (!CLIENT_ID || CLIENT_ID === 'tu_client_id_aqui') {
  console.error('[SERVER:CONFIG] DISCORD_CLIENT_ID no esta configurado en .env');
  process.exit(1);
}

// -- Express + WebSocket setup --
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// -- RPC Engine state --
let rpcClient = null;
let rpcEnabled = true;
let rpcConnected = false;
let pollTimer = null;
let lastTitle = '';
let trackStart = null;
let smallImageUrl = process.env.SMALL_IMAGE_URL || 'https://i.imgur.com/StuXjPv.png';
const artworkCache = new Map();

// Current track state broadcast to all WS clients
let currentState = {
  rpcEnabled: true,
  rpcConnected: false,
  qobuzDetected: false,
  track: null,
  smallImageUrl: '',
};

// -- Qobuz window detection --
function getQobuzWindowTitle() {
  try {
    const ps = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; (Get-Process Qobuz -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne '' }).MainWindowTitle`;
    const result = execSync(`chcp 65001 >nul && powershell -NoProfile -Command "${ps}"`, {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
    return result || null;
  } catch {
    return null;
  }
}

// Parses "Song (Album / Year) - Artist" or "Song - Artist"
function parseQobuzTitle(title) {
  if (!title || title === 'Qobuz') return null;

  const match = title.match(/^(.+?)\s*\((.+?)(?:\s*\/\s*(\d{4}))?\)\s*-\s*(.+)$/);
  if (match) {
    return {
      song: match[1].trim(),
      album: match[2].trim(),
      year: match[3] || null,
      artist: match[4].trim(),
    };
  }

  const simple = title.match(/^(.+?)\s*-\s*(.+)$/);
  if (simple) {
    return {
      song: simple[1].trim(),
      album: null,
      year: null,
      artist: simple[2].trim(),
    };
  }

  return null;
}

// -- iTunes artwork lookup with cache --
async function fetchArtwork(artist, song) {
  const cacheKey = `${artist}-${song}`;
  if (artworkCache.has(cacheKey)) {
    return artworkCache.get(cacheKey);
  }

  try {
    const query = encodeURIComponent(`${artist} ${song}`);
    const url = `https://itunes.apple.com/search?term=${query}&media=music&entity=song&limit=1`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.results && data.results.length > 0) {
      const artwork = data.results[0].artworkUrl100.replace('100x100bb', '512x512bb');
      artworkCache.set(cacheKey, artwork);
      return artwork;
    }
  } catch (err) {
    console.error(`[RPC:ITUNES] Error buscando caratula: ${err.message}`);
  }

  artworkCache.set(cacheKey, null);
  return null;
}

// -- Broadcast state to all connected WebSocket clients --
function broadcastState() {
  currentState.rpcEnabled = rpcEnabled;
  currentState.rpcConnected = rpcConnected;
  currentState.smallImageUrl = smallImageUrl;

  const payload = JSON.stringify({ type: 'state', data: currentState });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(payload);
    }
  });
}

// -- Polling loop: detect Qobuz track and update Discord --
async function updatePresence() {
  const title = getQobuzWindowTitle();
  const qobuzDetected = !!title && title !== 'Qobuz';
  currentState.qobuzDetected = qobuzDetected;

  if (!qobuzDetected) {
    if (lastTitle) {
      if (rpcConnected && rpcClient) {
        try { rpcClient.clearActivity(); } catch { /* noop */ }
      }
      console.log('[RPC:CLEAR] Qobuz detenido o minimizado');
      lastTitle = '';
      trackStart = null;
      currentState.track = null;
      broadcastState();
    } else if (!currentState.track) {
      broadcastState();
    }
    return;
  }

  if (title === lastTitle) return;

  const track = parseQobuzTitle(title);
  if (!track) return;

  lastTitle = title;
  trackStart = new Date();

  const artworkUrl = await fetchArtwork(track.artist, track.song);

  currentState.track = {
    song: track.song,
    artist: track.artist,
    album: track.album,
    year: track.year,
    artwork: artworkUrl,
    startedAt: trackStart.toISOString(),
  };

  broadcastState();

  // Update Discord RPC only if enabled and connected
  if (rpcEnabled && rpcConnected && rpcClient) {
    const activity = {
      type: 2,
      details: track.song,
      state: track.artist,
      startTimestamp: trackStart,
      instance: false,
    };

    if (artworkUrl) {
      activity.largeImageKey = artworkUrl;
      activity.largeImageText = track.album
        ? `${track.album}${track.year ? ` (${track.year})` : ''}`
        : 'Qobuz';
      activity.smallImageKey = smallImageUrl;
      activity.smallImageText = 'Hi-Res Audio';
    }

    try {
      rpcClient.setActivity(activity);
    } catch (err) {
      console.error(`[RPC:ERROR] Error actualizando actividad: ${err.message}`);
    }
  }

  const artStatus = artworkUrl ? 'con caratula' : 'sin caratula';
  console.log(`[RPC:TRACK] ${track.song} - ${track.artist}${track.album ? ` | ${track.album}` : ''} (${artStatus})`);
}

// -- Start/stop polling --
function startPolling() {
  if (pollTimer) return;
  updatePresence();
  pollTimer = setInterval(updatePresence, POLL_INTERVAL);
  console.log(`[SERVER:POLL] Monitoreando Qobuz cada ${POLL_INTERVAL / 1000}s`);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// -- Discord RPC connection management --
async function connectRpc() {
  if (rpcClient) return;

  rpcClient = new RPC.Client({ transport: 'ipc' });

  rpcClient.on('ready', () => {
    rpcConnected = true;
    console.log(`[RPC:READY] Conectado como ${rpcClient.user.username}#${rpcClient.user.discriminator}`);
    broadcastState();
    startPolling();
  });

  rpcClient.on('disconnected', () => {
    rpcConnected = false;
    console.log('[RPC:DISCONNECT] Desconectado de Discord');
    broadcastState();
  });

  try {
    await rpcClient.login({ clientId: CLIENT_ID });
  } catch (err) {
    console.error(`[RPC:ERROR] No se pudo conectar a Discord: ${err.message}`);
    rpcClient = null;
    rpcConnected = false;
    broadcastState();
    // Polling still runs to detect Qobuz and show track in UI
    startPolling();
  }
}

async function disconnectRpc() {
  if (rpcClient) {
    try { rpcClient.clearActivity(); } catch { /* noop */ }
    try { await rpcClient.destroy(); } catch { /* noop */ }
    rpcClient = null;
    rpcConnected = false;
    console.log('[RPC:STOP] RPC desconectado manualmente');
    broadcastState();
  }
}

// -- REST API endpoints --
app.get('/api/status', (_req, res) => {
  res.json({
    rpcEnabled,
    rpcConnected,
    qobuzDetected: currentState.qobuzDetected,
    track: currentState.track,
    smallImageUrl,
  });
});

app.post('/api/toggle', async (_req, res) => {
  rpcEnabled = !rpcEnabled;
  console.log(`[SERVER:TOGGLE] RPC ${rpcEnabled ? 'activado' : 'desactivado'}`);

  if (rpcEnabled) {
    await connectRpc();
  } else {
    await disconnectRpc();
    stopPolling();
    startPolling(); // Keep polling for UI, just no Discord
  }

  broadcastState();
  res.json({ rpcEnabled });
});

app.post('/api/settings', (req, res) => {
  const { smallImageUrl: newUrl } = req.body;

  if (newUrl !== undefined) {
    smallImageUrl = newUrl;
    console.log(`[SERVER:SETTINGS] Small image URL actualizada: ${smallImageUrl}`);
  }

  broadcastState();
  res.json({ smallImageUrl });
});

// -- WebSocket: send current state on connect --
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'state', data: currentState }));
});

// -- Startup sequence --
async function start() {
  server.listen(WEB_PORT, async () => {
    console.log(`[SERVER:START] Servidor web en http://localhost:${WEB_PORT}`);
    console.log(`[SERVER:INFO] Caratulas via iTunes Search API`);
    console.log('[SERVER:INFO] Presiona Ctrl+C para detener');

    // Open browser automatically
    try {
      const open = (await import('open')).default;
      await open(`http://localhost:${WEB_PORT}`);
    } catch {
      console.log(`[SERVER:INFO] Abre manualmente http://localhost:${WEB_PORT}`);
    }

    // Connect to Discord RPC
    await connectRpc();
  });
}

start();
