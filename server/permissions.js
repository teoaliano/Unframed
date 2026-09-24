// The permission decision: given a chat's runtime mode, a tool name and its input, is
// this allowed, denied, or does it need asking? One pure function, with the whole matrix
// behind it -- the shape env.js, presets.js and jobs.js use, and the reason this is a
// module rather than a branch inside `canUseTool`: the matrix can be tested without
// running a model.
//
// The four modes are t3code's (github.com/pingdotgg/t3code, MIT), which is where the
// behaviour people like comes from. The SDK enforces the mode itself through
// `permissionMode`; this decides the cases the SDK hands to `canUseTool`, and holds the
// thread-scoped grants the SDK does not.
//
// Ordering is plan < accept edits < auto < full, which is NOT Claude Code's own ordering
// of the same words: there `default` asks about edits and `acceptEdits` does not, so
// accept-edits is the looser of the two. Here auto is looser than accept-edits on
// purpose -- accept-edits means "write files, but ask before running anything", and auto
// means "get on with it, and stop me only for the dangerous things". The spec's user
// stories 11 and 12 say so in those words, and the SDK mapping below is what keeps the
// two orderings from colliding.

export const MODES = ['plan', 'acceptEdits', 'auto', 'full'];

export const SDK_PERMISSION_MODE = {
  plan: 'plan',
  acceptEdits: 'acceptEdits',
  auto: 'default',
  full: 'bypassPermissions',
};

export const DEFAULT_MODE = 'auto';

export const isMode = (mode) => MODES.includes(mode);

// Ours, and therefore never asked about: they are already scoped to this project's
// document and folder, and asking about them would make the thing the agent was already
// good at slower without making it safer (agentTools.js says what each one can do).
const OURS = /^mcp__unframed__/;

// The provider's own tools, grouped by what a person would be agreeing to. A tool this
// does not know is not assumed harmless -- it falls through to `ask`, which is what
// keeps a future SDK's new tool from arriving pre-approved.
const READS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'TodoWrite', 'Task']);
const EDITS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const RUNS = new Set(['Bash', 'BashOutput', 'KillShell', 'KillBash']);

// What a person would want to be stopped for even when they have said "get on with it":
// the things that are not undoable, that reach outside this machine, or that act as
// someone else. Deliberately a small list of shapes rather than a parser -- a shell
// command cannot be understood reliably, so this errs towards asking and the cost of a
// miss is one extra prompt, never a silent `rm -rf`.
const DANGEROUS = [
  /\brm\s+(-[a-zA-Z]*[rRf][a-zA-Z]*\s+)+/, //             recursive or forced delete
  /\bsudo\b|\bdoas\b/, //                                 as another user
  /\b(mkfs|diskutil|fdisk|dd)\b/, //                      the disk itself
  /\b(shutdown|reboot|halt|launchctl|systemctl)\b/, //     the machine
  /\b(chmod|chown)\s+-[a-zA-Z]*R/, //                     a whole tree's permissions
  /\bgit\s+push\b/, //                                    other people see it
  /\bgit\s+(reset\s+--hard|clean\s+-[a-zA-Z]*f)/, //       uncommitted work, gone
  /\b(npm|pnpm|yarn)\s+publish\b/, //                     the world sees it
  /\bcurl\b[^|]*\|\s*(ba)?sh\b|\bwget\b[^|]*\|\s*(ba)?sh\b/, // runs what a URL says
  /\bgh\s+(release|pr\s+merge|repo\s+delete)\b/, //        acts as the person on GitHub
  /:\(\)\s*\{.*\}\s*;\s*:/, //                            fork bomb
];

export const isDangerous = (command) => DANGEROUS.some((re) => re.test(String(command ?? '')));

// What a thread-scoped grant covers -- the "kind" of request story 18 means when it says
// "for the rest of the thread". For most tools that is the tool itself; for a shell
// command it is the PROGRAM, so agreeing to `git` once does not also agree to `curl`.
// Granting a whole tool named Bash would be full access under another name.
//
// A command from the dangerous list is its own kind, whole. The person answering a prompt
// about `git status` agreed to `git`, and a command that rewrites history is not what they
// were looking at -- so the harder a thing is to undo, the narrower the grant it hands out.
export function signatureOf(tool, input) {
  if (tool !== 'Bash') return tool;
  const command = String(input?.command ?? '').trim();
  if (isDangerous(command)) return `Bash!${command.slice(0, 300)}`;
  const program = command.split(/\s+/)[0] ?? '';
  return program ? `Bash:${program}` : 'Bash';
}

// The one line a person reads before deciding: what this will actually touch. Never the
// whole input, which for a Write is the entire file.
export function describe(tool, input) {
  if (tool === 'Bash') return String(input?.command ?? '').slice(0, 300);
  const target = input?.file_path ?? input?.path ?? input?.notebook_path ?? input?.pattern ?? input?.url ?? '';
  return String(target).slice(0, 300);
}

const outcome = (verdict, tool, input, reason) => ({ verdict, tool, signature: signatureOf(tool, input), target: describe(tool, input), ...(reason ? { reason } : {}) });

// `grants` is what the person has already agreed to for the rest of this chat: an array
// of signatures. It is consulted BEFORE the matrix, so a grant is what stops the twentieth
// identical request from being the twentieth prompt -- and AFTER the ours-and-full short
// circuits, which need no grant to begin with.
export function decide({ mode, tool, input = {}, grants = [] }) {
  if (OURS.test(tool)) return outcome('allow', tool, input);
  if (mode === 'full') return outcome('allow', tool, input);
  if (!isMode(mode)) return outcome('ask', tool, input, `This chat has no runtime mode set.`);

  if (READS.has(tool)) return outcome('allow', tool, input);

  // Plan mode is the one mode that answers `deny` rather than `ask`: the whole point is
  // that the agent describes what it would do without doing any of it, so a prompt in the
  // middle of planning would defeat it. The message is written to the AGENT, which is
  // what makes it try the other way instead of stalling.
  if (mode === 'plan') return outcome('deny', tool, input, 'This chat is in plan mode: describe what you would do, and do not change anything yet.');

  if (grants.includes(signatureOf(tool, input))) return outcome('allow', tool, input);

  if (EDITS.has(tool)) return mode === 'acceptEdits' || mode === 'auto' ? outcome('allow', tool, input) : outcome('ask', tool, input);

  if (RUNS.has(tool)) {
    if (mode === 'acceptEdits') return outcome('ask', tool, input);
    // auto: ordinary work proceeds, and only the things that cannot be undone stop you.
    return tool === 'Bash' && isDangerous(input?.command) ? outcome('ask', tool, input, 'This command cannot be undone.') : outcome('allow', tool, input);
  }

  // A tool nobody here has heard of -- a future SDK's, or the user's own MCP server's now
  // that settingSources is open. Asking is the only answer that is not a guess.
  return outcome('ask', tool, input, 'Unframed does not know what this tool does.');
}
