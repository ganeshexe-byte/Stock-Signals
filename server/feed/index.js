const cfg = require('../config');
const { MockFeed } = require('./mock');

let feed;
if (cfg.useAngel) {
  const { AngelFeed } = require('./angel');
  feed = new AngelFeed(cfg.angel);
} else {
  feed = new MockFeed();
}

module.exports = feed;
