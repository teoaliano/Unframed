// Rendering a motion (server/motion.js) drives the Chrome the person already has --
// Google Chrome, Chromium, Edge or Brave, found where each platform installs it -- so the
// ~170MB Chrome for Testing that puppeteer (a dependency of @hyperframes/producer) would
// otherwise download on `npm install` is never fetched. A machine with no Chromium at all
// gets a plain message from the Render button saying to install one. Puppeteer finds this
// file by walking up from its own folder, so it also holds when this repo is installed as
// a dependency of the desktop shell.
module.exports = { skipDownload: true };
