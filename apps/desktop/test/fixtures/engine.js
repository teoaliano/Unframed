const { spawn } = require('node:child_process');
const fs = require('node:fs');

const mode = process.env.FIXTURE_MODE || 'normal';

if (mode === 'crash-on-boot') process.exit(3);

if (mode === 'grandchild') {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000); process.on("SIGTERM", () => {});'], {
    stdio: 'ignore',
  });
  fs.writeFileSync(process.env.FIXTURE_PIDFILE, String(child.pid));
}

if (mode === 'stubborn') process.on('SIGTERM', () => {});
else process.on('SIGTERM', () => setTimeout(() => process.exit(0), 50));

setInterval(() => {}, 1000);

if (mode !== 'silent') {
  console.log('Unframed server on 4321');
  process.send({ type: 'ready', port: 4321, previewPort: 4322 });
}

process.on('message', (msg) => {
  if (msg === 'reveal') process.send({ type: 'reveal', files: ['/tmp/a.png'] });
  if (msg === 'die') process.exit(7);
});
