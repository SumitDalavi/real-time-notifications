const express = require('express');
const { WebSocketServer } = require('ws');
const Redis = require('ioredis');

const app = express();
const pub = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const sub = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const clients = new Map();

sub.subscribe('notifications');
sub.on('message', (channel, message) => {
    const { userId, payload } = JSON.parse(message);
    const ws = clients.get(userId);
    if (ws) ws.send(JSON.stringify(payload));
});

let server;
let wss;

function init(httpServer) {
    server = httpServer;
    wss = new WebSocketServer({ server });
    
    wss.on('connection', (ws, req) => {
        const userId = new URL(req.url, 'http://localhost').searchParams.get('userId');
        clients.set(userId, ws);
        ws.on('close', () => clients.delete(userId));
    });
}

app.post('/notify/:userId', express.json(), (req, res) => {
    pub.publish('notifications', JSON.stringify({ userId: req.params.userId, payload: req.body }));
    res.send('Published');
});

if (require.main === module) {
    const httpServer = app.listen(3000, () => console.log('Listening on 3000'));
    init(httpServer);
}

module.exports = { app, init, pub, sub, clients };
