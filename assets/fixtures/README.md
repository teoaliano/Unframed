# Scripted agent fixtures

Each `.json` file here is one scripted-agent scenario in spec 07's script format. Point `UNFRAMED_TEST_AGENT_SCRIPT` at this folder to load them all. `assets/README.md` says what each file covers.

- Shape ids in the fixtures (`m1`, `m2`, `i3`) are the ids a test seeds before it sends the first message. Seed a motion `m1` titled "Intro", a motion `m2` titled "Outro" and an image `i3` named "hero.png" where a fixture names them. `bad-shape` expects `m1` to be missing.
- Tool inputs use spec 07's names: `shapeId`, and `canvas_write` ops named by `type` (`update` with `props`).
- No two `when` patterns match the first message a test is meant to send, so the order the scripts load in does not matter.
- `render-stub.mp4` is not a script. It is the one-second clip the `ok` stub renderer returns (spec 09).
