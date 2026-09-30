# Change note

Used by spec 07, as the second part of the preamble the model reads before each message. The engine writes this sentence only when the canvas changed since this chat's last turn ended (its `lastClock`). With no changes it writes nothing.

Source: the old app's `changeSentence` in `server/agentTools.js`. The old clause about undos of this chat's changes is replaced by a clause about reverts of this chat's turns, since Revert is now the only way to take an agent change back. The rest is the old text.

## Counting

Count the change log rows past `lastClock`, leaving out `system` rows and this chat's own `chat:<chatId>` rows. A change is one distinct shape changed by one origin.

- `<person>`: changes whose origin is `person` or any `revert:` origin. A revert counts as the person's, because the person asked for it.
- `<other>`: changes whose origin is `chat:<id>` of another chat.
- `<reverted>`: the number of distinct turns of this chat that were reverted (distinct `revert:<chatId>:<turn>` origins for this chat).

## Template

```text
Since your last turn the canvas changed: <parts><revert clause>. Read it again before acting.
```

`<parts>` is the parts below that are not zero, joined with ", ". Each says "change" for 1 and "changes" otherwise.

```text
<person> change(s) by the person
```

```text
<other> change(s) by another chat
```

`<revert clause>` is empty when `<reverted>` is 0. When it is 1:

```text
, including a revert of one of your turns
```

When it is more than 1:

```text
, including reverts of <reverted> of your turns
```

## Examples

```text
Since your last turn the canvas changed: 2 changes by the person. Read it again before acting.
```

```text
Since your last turn the canvas changed: 1 change by the person, 3 changes by another chat. Read it again before acting.
```

```text
Since your last turn the canvas changed: 4 changes by the person, including a revert of one of your turns. Read it again before acting.
```
