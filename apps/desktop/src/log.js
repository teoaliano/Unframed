const fs = require('node:fs');
const path = require('node:path');

function createLog({ dir, name = 'main.log', maxBytes = 2 * 1024 * 1024, echo = true }) {
  const file = path.join(dir, name);
  const old = path.join(dir, name.replace(/\.log$/, '.old.log'));
  let ready = false;

  function write(level, args) {
    const text = args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    const line = `${new Date().toISOString()} [${level}] ${text}\n`;
    if (echo) process.stdout.write(line);
    try {
      if (!ready) {
        fs.mkdirSync(dir, { recursive: true });
        ready = true;
      }
      try {
        if (fs.statSync(file).size > maxBytes) fs.renameSync(file, old);
      } catch {}
      fs.appendFileSync(file, line);
    } catch {}
  }

  return {
    file,
    info: (...a) => write('info', a),
    warn: (...a) => write('warn', a),
    error: (...a) => write('error', a),
    debug: (...a) => write('debug', a),
  };
}

function createRecordStore(file) {
  return {
    read() {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        return null;
      }
    },
    write(record) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(record));
    },
    remove() {
      fs.rmSync(file, { force: true });
    },
  };
}

module.exports = { createLog, createRecordStore };
