const request = require('supertest');
const WebSocket = require('ws');
const http = require('http');
const { app, init, clients, messageBuffer, presence } = require('../index');

describe('Real-Time Notifications', () => {
    let server;
    let wssUrl;

    beforeAll((done) => {
        server = http.createServer(app);
        init(server);
        server.listen(0, () => {
            wssUrl = `ws://localhost:${server.address().port}`;
            done();
        });
    });

    afterAll((done) => {
        server.close(done);
    });

    beforeEach(() => {
        clients.clear();
        messageBuffer.clear();
        presence.clear();
    });

    it('should track user presence and broadcast to active connection', (done) => {
        const ws = new WebSocket(`${wssUrl}?userId=user1`);

        ws.on('open', async () => {
            // Check presence
            const pRes = await request(app).get('/presence/user1');
            expect(pRes.body.status).toBe('online');

            // Send notification
            const res = await request(app).post('/notify/user1').send({ alert: 'Test' });
            expect(res.body.delivered).toBe(true);
            expect(res.body.devices).toBe(1);
        });

        ws.on('message', (msg) => {
            const data = JSON.parse(msg);
            expect(data.type).toBe('NOTIFICATION');
            expect(data.payload.alert).toBe('Test');
            ws.close();
        });

        ws.on('close', async () => {
            // Check presence after close
            setTimeout(async () => {
                const pRes2 = await request(app).get('/presence/user1');
                expect(pRes2.body.status).toBe('offline');
                done();
            }, 50);
        });
    });

    it('should buffer messages when user is offline and sync upon reconnect', (done) => {
        // User is offline, send notification
        request(app).post('/notify/user2').send({ alert: 'Missed me' }).end((err, res) => {
            expect(res.body.delivered).toBe(false);
            expect(res.body.buffered).toBe(true);

            // Now user connects
            const ws = new WebSocket(`${wssUrl}?userId=user2`);
            
            ws.on('message', (msg) => {
                const data = JSON.parse(msg);
                if (data.type === 'SYNC') {
                    expect(data.messages.length).toBe(1);
                    expect(data.messages[0].payload.alert).toBe('Missed me');
                    ws.close();
                    done();
                }
            });
        });
    });

    it('should support multiple devices for same user', (done) => {
        let msgsReceived = 0;
        const ws1 = new WebSocket(`${wssUrl}?userId=user3`);
        const ws2 = new WebSocket(`${wssUrl}?userId=user3`);

        const handleMsg = (msg) => {
            const data = JSON.parse(msg);
            expect(data.payload.alert).toBe('Multi-device');
            msgsReceived++;
            if (msgsReceived === 2) {
                ws1.close();
                ws2.close();
                done();
            }
        };

        ws1.on('message', handleMsg);
        ws2.on('message', handleMsg);

        ws1.on('open', () => {
            ws2.on('open', async () => {
                const res = await request(app).post('/notify/user3').send({ alert: 'Multi-device' });
                expect(res.body.delivered).toBe(true);
                expect(res.body.devices).toBe(2);
            });
        });
    });
});
