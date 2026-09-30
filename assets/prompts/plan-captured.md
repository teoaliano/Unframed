# Plan captured

Used by spec 07's permission policy. When Claude calls `ExitPlanMode`, the engine captures `input.plan` as the turn's proposed plan and denies the call with this message, so the agent stops and waits. No placeholders.

Source: t3code (github.com/pingdotgg/t3code, MIT licence), `apps/server/src/provider/Layers/ClaudeAdapter.ts`, the `ExitPlanMode` deny message. Verbatim.

```text
The client captured your proposed plan. Stop here and wait for the user's feedback or implementation request in a later turn.
```
