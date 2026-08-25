const request = require('supertest');
const { WebSocket } = require('ws');
const http = require('http');

jest.mock('ioredis', () => {
    const EventEmitter = require('events');
    class MockRedis extends EventEmitter {
        subscribe() {}
        publish(channel, message) {
            this.emit('message', channel, message);
        }
        quit() {}
    }
    const instance = new MockRedis();
    return jest.fn(() => instance);
});

const { app, init, pub, sub, clients } = require('../index');

describe('Real Time Notifications API', () => {
    let server;
    beforeAll((done) => {
        server = http.createServer(app);
        init(server);
        server.listen(0, done);
    });

    afterAll((done) => {
        pub.quit();
        sub.quit();
        server.close(done);
    });

    it('should connect ws and receive notification', (done) => {
        const port = server.address().port;
        const ws = new WebSocket(`ws://localhost:${port}/?userId=user123`);
        
        ws.on('open', async () => {
            // Give time for connection to register
            setTimeout(async () => {
                const res = await request(app)
                    .post('/notify/user123')
                    .send({ alert: 'Test!' });
                
                expect(res.statusCode).toEqual(200);
            }, 50);
        });

        ws.on('message', (data) => {
            const payload = JSON.parse(data);
            expect(payload.alert).toEqual('Test!');
            ws.close();
            done();
        });
    });
});
