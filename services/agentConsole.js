const clients = new Set();

export function registerClient(res) {
  clients.add(res);
  res.on('close', () => {
    clients.delete(res);
  });
}

export function log(message, type = 'info') {
  const data = JSON.stringify({ message, type });
  for (const res of clients) {
    res.write(`data: ${data}\n\n`);
  }
}
