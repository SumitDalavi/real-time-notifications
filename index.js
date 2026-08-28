const express = require('express');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// --- Core State ---
// Map of userId -> Set of WebSocket connections (supports multiple devices per user)
const clients = new Map();

// Map of userId -> Array of missed messages
const messageBuffer = new Map();

// Map of userId -> { status: 'online' | 'offline', lastSeen: number }
const presence = new Map();

// --- Notification Engine Logic ---
function trackPresence(userId, status) {
    presence.set(userId, { status, lastSeen: Date.now() });
}

function bufferMessage(userId, message) {
    if (!messageBuffer.has(userId)) {
        messageBuffer.set(userId, []);
    }
    // Store message with timestamp and ID for deduplication/syncing
    messageBuffer.get(userId).push({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        ...message
    });
    // Keep only last 50 messages to prevent memory leak
    if (messageBuffer.get(userId).length > 50) {
        messageBuffer.get(userId).shift();
    }
}

function syncMissedMessages(userId, ws) {
    const missed = messageBuffer.get(userId);
    if (missed && missed.length > 0) {
        ws.send(JSON.stringify({ type: 'SYNC', messages: missed }));
        // Clear buffer after sync
        messageBuffer.set(userId, []);
    }
}

// --- WebSocket Server Initialization ---
let server;
let wss;

function init(httpServer) {
    server = httpServer;
    wss = new WebSocketServer({ server });
    
    wss.on('connection', (ws, req) => {
        const userId = new URL(req.url, 'http://localhost').searchParams.get('userId');
        if (!userId) {
            ws.close(4001, 'userId is required');
            return;
        }

        if (!clients.has(userId)) {
            clients.set(userId, new Set());
        }
        clients.get(userId).add(ws);

        // Mark user as online
        trackPresence(userId, 'online');

        // Sync missed messages upon successful connect/reconnect
        syncMissedMessages(userId, ws);

        ws.on('close', () => {
            const userConnections = clients.get(userId);
            if (userConnections) {
                userConnections.delete(ws);
                if (userConnections.size === 0) {
                    // User has closed all devices, mark offline
                    trackPresence(userId, 'offline');
                }
            }
        });
    });
}

// --- API Endpoints ---
app.post('/notify/:userId', (req, res) => {
    const { userId } = req.params;
    const payload = req.body;

    const userConnections = clients.get(userId);
    const userIsOnline = userConnections && userConnections.size > 0;

    const message = { type: 'NOTIFICATION', payload };

    if (userIsOnline) {
        // Broadcast to all active connections for this user
        for (const ws of userConnections) {
            ws.send(JSON.stringify(message));
        }
        res.json({ delivered: true, devices: userConnections.size });
    } else {
        // User offline, buffer message for reconnect semantics
        bufferMessage(userId, message);
        res.json({ delivered: false, buffered: true });
    }
});

app.get('/presence/:userId', (req, res) => {
    const state = presence.get(req.params.userId) || { status: 'offline', lastSeen: null };
    res.json(state);
});

if (require.main === module) {
    const httpServer = app.listen(3000, () => console.log('Listening on 3000'));
    init(httpServer);
}

module.exports = { app, init, clients, messageBuffer, presence, trackPresence, bufferMessage };
