import net from 'node:net';

const port = Number(process.env.VITE_FRONTEND_PORT || 5173);
const hosts = ['127.0.0.1', '::1'];

function acceptsConnections(host) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(350);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

const occupiedHosts = [];
for (const host of hosts) {
  if (await acceptsConnections(host)) {
    occupiedHosts.push(host);
  }
}

if (occupiedHosts.length > 0) {
  console.error(
    `ERROR: Frontend port ${port} is already active on ${occupiedHosts.join(', ')}. Stop the existing frontend before starting another one.`,
  );
  process.exit(1);
}
