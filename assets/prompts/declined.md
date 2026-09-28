# Declined request

Used by spec 07. The permission policy denies a tool call with this message when the person answers a request with Decline. It is written to the agent, so it tries another way instead of stalling. No placeholders.

Source: the old app's `DECLINED` in `server/agent.js`, verbatim.

```text
The person declined this. Do not try it again; say what you would have done, or find another way.
```
