# Chat title request

Used by spec 07's titling. After a chat's first turn settles, the engine sends one tool-less request on the chat's own provider with this system prompt and this prompt. The first line of the reply becomes the title.

Placeholders in the prompt: `<first message>` is the chat's first user message. `<answer>` is the first 400 characters of the agent's answer. The two are separated by one newline.

Source: the old app's `askForTitle` in `server/agent.js`, verbatim.

## System prompt

```text
You name conversations. Answer with the title alone.
```

## Prompt

```text
Title this conversation in three to five words, no quotes: <first message>
<answer>
```
