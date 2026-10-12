// electron-builder writes latest-mac.yml from each artifact's bytes at the moment it
// was built. build/notarize-dmg.js staples the DMG afterwards, which changes those
// bytes, so the feed then describes a file nobody downloads. This rewrites the sha512
// and size of each named artifact from the file that is actually uploaded.
//
// Usage: node build/rehash-feed.js dist/latest-mac.yml dist/Unframed-arm64.dmg
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const [feedPath, ...files] = process.argv.slice(2);
if (!feedPath || !files.length) {
  console.error('usage: node build/rehash-feed.js <feed.yml> <artifact>...');
  process.exit(2);
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let feed = fs.readFileSync(feedPath, 'utf8');
for (const file of files) {
  const name = path.basename(file);
  const bytes = fs.readFileSync(file);
  const sha512 = crypto.createHash('sha512').update(bytes).digest('base64');

  // Matches the `files:` entry for this artifact. The top-level `path`/`sha512`
  // pair is the zip's and is left alone.
  const entry = new RegExp(`(- url: ${escapeRegExp(name)}\\n\\s+sha512: )\\S+(\\n\\s+size: )\\d+`);
  if (!entry.test(feed)) {
    throw new Error(`no files entry for ${name} in ${feedPath}`);
  }
  feed = feed.replace(entry, `$1${sha512}$2${bytes.length}`);
  console.log(`re-hashed  file=${name}  size=${bytes.length}`);
}

fs.writeFileSync(feedPath, feed);
