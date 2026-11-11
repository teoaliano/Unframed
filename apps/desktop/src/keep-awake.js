// The engine's keep-awake message (spec 22). One blocker at most, whatever the
// engine sends: `prevent-app-suspension` lets the display sleep and keeps the
// process running, so the canvas a paired iPad is drawing on stays live.
function createKeepAwake(blocker) {
  let id = null;
  return {
    set(on) {
      if (on) {
        if (id === null) id = blocker.start('prevent-app-suspension');
        return;
      }
      if (id === null) return;
      blocker.stop(id);
      id = null;
    },
    held() {
      return id !== null;
    },
  };
}

module.exports = { createKeepAwake };
