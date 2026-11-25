# Screen states

Used by the Screen states spec ("Agent"). A Screen holds a state: a route, the steps that reach it from there, and the mocks that make it happen. The tool section describes the agent's tool that proves a state and saves it on a Screen. The fix instruction is what "Ask the agent to fix it" sends into a thread started from a Screen whose steps no longer work: `<shape>` is the Screen's id, `<state>` its state in plain words, `<branch>` the Instance's branch, `<route>` the Screen's route, `<steps>` and `<mocks>` its steps and mocks as JSON, `<number>` the failed step's position counting from 1, `<step>` that step in plain words and `<reason>` why it failed.

## screen_state

```text
Prove a state of the app and save it on a Screen. A state is a route, the steps that reach it from there (click, type, press, hover, wait, scroll), and the mocks that make it happen (a request answered with a status, headers, a body and a delay, or failed as a network error). Unframed loads the route in a headless browser against the Screen's Instance with the mocks applied, replays the steps, and only when every step works saves the state on the Screen, or on a new Screen beside it when newScreen is true; it answers with a snapshot either way. When a step fails nothing changes, and the answer names the step and shows where it stopped. Name each target by its accessible role and name first ({"role": "button", "name": "Generate"}), then by its visible text ({"text": "Settings"}), and by a CSS selector only as a last resort. Mocks match a request by method and URL pattern, where * matches anything and a pattern starting with / matches any origin; the first match wins. Prefer mocks to changing code for empty, failing and slow states. Explore with the preview tools first, then make one call per state.
```

- `shapeId`: The Screen to save the state on, or to place the new Screen beside.
- `route`: The route the state starts from, such as /settings.
- `steps`: The steps in order. Each is {"action": "click" | "hover" | "wait" | "scroll", "target": …}, {"action": "type", "target": …, "text": "…"} or {"action": "press", "key": "Enter", "target"?: …}.
- `mocks`: The mocks. Each is {"method"?: "GET", "url": "/api/items", "status"?: 200, "headers"?: {…}, "body"?: text or JSON, "delay"?: milliseconds} or {"url": "…", "fail": true}.
- `state`: The state in a few plain words, such as "the generate menu open". It labels the Screen.
- `newScreen`: Put the state on a new Screen of the same Instance beside this one instead of changing this one.

## Fix a state

```text
The Screen <shape> on the branch "<branch>" no longer reaches its state "<state>": step <number>, <step>, failed: <reason>. It starts from <route>, with the steps <steps> and the mocks <mocks>. Open the Screen with the preview tools, find what changed in the app, and call screen_state on the same Screen with corrected steps, keeping the state and the mocks unless they are what broke. Change no code.
```
