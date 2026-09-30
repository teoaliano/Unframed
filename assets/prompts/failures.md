# Failure sentences

Used by spec 07. When a turn fails, the engine appends one of these sentences below whatever the agent already said, as a new paragraph. Pick the sentence by the provider's failure subtype. `<subtype>` is the subtype as the provider reported it.

Source: the old app's `FAILURES` and `failureMessage` in `server/agent.js`, and `QUIT_MID_TURN` in `server/threads.js`. Copied verbatim, em dashes included.

## By subtype

`error_during_execution`:

```text
The agent stopped part-way through this turn. Nothing further was run — ask again, and say what you want done first.
```

`error_max_turns`:

```text
The agent reached its limit of steps for one turn and stopped. Ask again, more narrowly — one change at a time.
```

`error_max_budget_usd`:

```text
The agent reached the spending limit set for one turn and stopped.
```

`error_max_structured_output_retries`:

```text
The agent could not produce a usable answer after several attempts. Ask again, more plainly.
```

## Fallbacks

Any other subtype:

```text
The agent failed: <subtype>.
```

No subtype:

```text
The agent reported an error.
```

## Quit mid-turn

The failure a chat reads with when the engine stopped while its turn was running (spec 07, restart reconciliation). It is the turn's error and the chat's `lastError`.

```text
Unframed stopped while this turn was running, so it never finished. Send again to carry on where it left off.
```
