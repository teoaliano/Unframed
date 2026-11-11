function channelOf(pkg, env) {
  const dev = pkg?.unframedChannel === 'dev';
  return {
    dev,
    updates: !dev,
    dataFolder: dev ? 'Unframed Dev' : null,
    outputFolder: dev ? 'Unframed Dev' : 'Unframed',
    engineEnv: dev && !env.UNFRAMED_FEATURES ? { UNFRAMED_FEATURES: 'all' } : {},
  };
}

module.exports = { channelOf };
