const base = require('../package.json').build;

module.exports = {
  ...base,
  mac: { ...base.mac, target: [{ target: 'zip', arch: ['arm64'] }], notarize: false },
  afterAllArtifactBuild: null,
  publish: [{ provider: 'generic', url: process.env.E2E_FEED_URL }],
  directories: { output: process.env.E2E_OUT },
  extraMetadata: { name: 'unframed-app-e2e', version: process.env.E2E_VERSION },
};
