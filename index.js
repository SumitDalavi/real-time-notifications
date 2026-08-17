const express = require('express');
const { WebSocketServer } = require('ws');
const Redis = require('ioredis');

const app = express();
const server = app.listen(3000);
const wss = new WebSocketServer({ server });
const pub = new Redis();
const sub = new Redis();

const clients = new Map();

sub.subscribe('notifications');
sub.on('message', (channel, message) => {
    const { userId, payload } = JSON.parse(message);
    const ws = clients.get(userId);
    if (ws) ws.send(JSON.stringify(payload));
});

wss.on('connection', (ws, req) => {
    const userId = new URL(req.url, 'http://localhost').searchParams.get('userId');
    clients.set(userId, ws);
    ws.on('close', () => clients.delete(userId));
});

app.post('/notify/:userId', express.json(), (req, res) => {
    pub.publish('notifications', JSON.stringify({ userId: req.params.userId, payload: req.body }));
    res.send('Published');
});
