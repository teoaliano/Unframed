# Implement a plan

Used by spec 08. Implement (and Implement in a new chat) sends this prefix followed directly by the plan's markdown, trimmed, with nothing between them. The prefix ends in a newline, so the plan starts on the second line. `<plan>` is the trimmed plan.

Source: t3code (github.com/pingdotgg/t3code, MIT licence), `apps/web/src/proposedPlan.ts`, `PLAN_IMPLEMENTATION_PROMPT_PREFIX`. Verbatim.

```text
PLEASE IMPLEMENT THIS PLAN:
<plan>
```
