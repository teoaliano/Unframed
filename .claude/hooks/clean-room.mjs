#!/usr/bin/env node
// Blocks any tool call that would read the old Unframed code. This repo is a clean-room
// rewrite: the specs in docs/specs are the only description of the old app it may use.
// Edit BLOCKED if the old checkouts live somewhere else on this machine.
const BLOCKED = [
  /\/Users\/matteoaliano\/Unframed(?=[\/\s"'`]|$)/, // the old engine checkout (not Unframed-rewrite-kit)
  /\/Users\/matteoaliano\/Unframed-app(?=[\/\s"'`]|$)/, // the private desktop shell
  /teoaliano\/Unframed(?:\.git)?(?=[\/\s"'`#?]|$)/, // the old engine on GitHub
  /teoaliano\/Unframed-app/,
  /(?:^|[\s"'`=])\.\.\/Unframed(?:-app)?(?=[\/\s"'`]|$)/, // a sibling checkout by relative path
];
let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw); } catch { process.exit(0); }
  const text = JSON.stringify(input.tool_input ?? {});
  const hit = BLOCKED.find((re) => re.test(text));
  if (!hit) process.exit(0);
  process.stderr.write(
    'Blocked by the clean-room rule: this repo is a rewrite and must not read the old Unframed code or repos. ' +
      'Work from docs/specs and assets/ only. If you need a fact the specs do not give, stop and ask the person.\n',
  );
  process.exit(2);
});
