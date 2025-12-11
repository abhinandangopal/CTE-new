import ws from 'k6/ws';
import { check } from 'k6';

export const options = {
  vus: 50, // 50 Virtual Users
  duration: '30s', // Run for 30 seconds
};

export default function () {
  const url = 'ws://localhost:8081?docId=load-test-doc&userId=user-' + __VU;
  const params = { tags: { my_tag: 'hello' } };

  const res = ws.connect(url, params, function (socket) {
    socket.on('open', () => {
      // User types every 1 second
      socket.setInterval(() => {
        socket.send(JSON.stringify({
          type: 'update',
          content: 'Stress test data ' + Date.now(),
          userId: 'user-' + __VU
        }));
      }, 1000);
    });

    socket.on('close', () => console.log('disconnected'));
  });

  check(res, { 'status is 101': (r) => r && r.status === 101 });
}