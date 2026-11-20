// Tiny JSON-file store with atomic writes. One file per collection in /data.
const fs = require('fs');
const path = require('path');
const { dataDir } = require('./config');

fs.mkdirSync(dataDir, { recursive: true });
const timers = new Map();
const cache = new Map();

function file(name) { return path.join(dataDir, `${name}.json`); }

function load(name, fallback) {
  if (cache.has(name)) return cache.get(name);
  let v;
  try { v = JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { v = typeof fallback === 'function' ? fallback() : fallback; }
  cache.set(name, v);
  return v;
}

function flush(name) {
  const v = cache.get(name);
  if (v === undefined) return;
  const tmp = file(name) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, file(name));
}

// Debounced save (500 ms) so bursts of fills don't hammer the disk
function save(name) {
  clearTimeout(timers.get(name));
  timers.set(name, setTimeout(() => flush(name), 500));
}

function flushAll() { for (const n of cache.keys()) flush(n); }
process.on('exit', flushAll);

module.exports = { load, save, flush, flushAll };
