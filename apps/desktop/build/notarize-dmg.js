// electron-builder notarizes the .app and then wraps it in a DMG it never submits,
// so the DMG carries no ticket: `spctl` calls it "no usable signature" and
// `stapler staple` fails with "Record not found". The app a user drags out is
// stapled and launches cleanly, but Apple's guidance is to staple the artifact you
// actually distribute, and an unstapled DMG needs an online check to verify.
//
// This runs after the artifacts exist and gives the DMG its own submission -- a
// second trip through Apple's queue, which is why it is gated rather than automatic.
//
// It must finish before anything is uploaded. Stapling rewrites the DMG's bytes, so
// the sha512 in latest-mac.yml and the DMG's blockmap both describe the unstapled
// file unless they are rebuilt here. The mac job publishes with --publish never and
// uploads afterwards, and build/rehash-feed.js re-hashes the feed from the stapled DMG.
const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { appBuilderPath } = require('app-builder-bin');

const REQUIRED = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'];

// Apple only notarizes code signed with a Developer ID, so submitting anything else
// wastes a queue trip and comes back Invalid. electron-builder skips signing on pull
// request builds -- deliberately, since a PR from a fork could otherwise exfiltrate
// the certificate -- so this is a real state, not a hypothetical one.
//
// "Is it signed at all" is NOT the question: Electron ships its frameworks
// pre-signed, so an app electron-builder never touched still satisfies `codesign
// -dv`. Apple rejects it anyway, naming a nested framework and "The signature does
// not include a secure timestamp." The authority is what actually distinguishes the
// two. codesign reports on stderr, hence spawnSync over execFileSync.
function isSignedForDistribution(appPath) {
  const r = spawnSync('codesign', ['-dv', '--verbose=2', appPath], { encoding: 'utf8' });
  return /Authority=Developer ID Application/.test((r.stdout || '') + (r.stderr || ''));
}

exports.default = async function notarizeDmg(buildResult) {
  if (process.platform !== 'darwin') return [];

  const dmgs = (buildResult.artifactPaths || []).filter((p) => p.endsWith('.dmg'));
  if (!dmgs.length) return [];

  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    console.log(`  • skipped DMG notarization  reason=${missing.join(', ')} not set`);
    return [];
  }

  const outDir = buildResult.outDir || path.dirname(dmgs[0]);
  const app = fs
    .readdirSync(outDir)
    .filter((d) => d.startsWith('mac'))
    .map((d) => path.join(outDir, d, 'Unframed.app'))
    .find((p) => fs.existsSync(p));

  if (!app || !isSignedForDistribution(app)) {
    console.log('  • skipped DMG notarization  reason=no Developer ID signature, Apple would reject it');
    return [];
  }

  const creds = [
    '--key', process.env.APPLE_API_KEY,
    '--key-id', process.env.APPLE_API_KEY_ID,
    '--issuer', process.env.APPLE_API_ISSUER,
  ];

  for (const dmg of dmgs) {
    const name = path.basename(dmg);
    console.log(`  • notarizing DMG  file=${name}`);
    // notarytool exits 0 for a completed submission even when the verdict is
    // Invalid -- it succeeded at asking. Without reading the verdict the build
    // sails on and fails later at `stapler` with "Record not found", which points
    // at the wrong thing entirely. Read the status, and on rejection print Apple's
    // own log, which names the offending file.
    const out = execFileSync('xcrun', ['notarytool', 'submit', dmg, ...creds, '--wait'], {
      encoding: 'utf8',
    });
    process.stdout.write(out);

    if (!/status:\s*Accepted/.test(out)) {
      const id = (out.match(/id:\s*([0-9a-f-]{36})/) || [])[1];
      if (id) {
        console.log(`  • Apple rejected it. Its log for ${id}:`);
        try {
          process.stdout.write(
            execFileSync('xcrun', ['notarytool', 'log', id, ...creds], { encoding: 'utf8' }),
          );
        } catch {
          console.log('    (could not fetch the log)');
        }
      }
      throw new Error(`Notarization was not accepted for ${name}`);
    }

    console.log(`  • stapling DMG  file=${name}`);
    execFileSync('xcrun', ['stapler', 'staple', dmg], { stdio: 'inherit' });

    // Same command electron-builder ran to write this blockmap, now against the
    // stapled bytes. Overwrites the file in place; the upload reads it afterwards.
    execFileSync(appBuilderPath, ['blockmap', '--input', dmg, '--output', `${dmg}.blockmap`], {
      stdio: 'ignore',
    });
  }

  return [];
};
