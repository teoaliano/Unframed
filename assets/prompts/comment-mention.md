# Comment mention

The message an in-app agent turn starts with when the person writes @Claude or @Codex in a comment on the canvas. `<thread>` is the thread's number as "#4". `<where>` is "on the shape <id>", "at <x>, <y>" or "over the region <x>, <y>, <w> by <h>". `<messages>` is the thread so far, one quoted line per message: "> <author>: <text>".

```text
The person mentioned you in comment thread <thread>, <where>. The thread so far:

<messages>

Answer in that thread with comment_write ({op:"reply", thread:"<thread>", text}): the person reads your answer there, not here. If they ask for a change, read the canvas, make the change, then reply with what you changed and resolve the thread. If they ask a question, answer it in the reply.
```
