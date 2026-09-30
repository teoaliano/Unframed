# Performance fixtures and method

- `busy-page.html`: a page artifact that redraws a 1024 by 1024 canvas and reads its pixels back on every animation frame. Spec 09's artifact budget puts ten of these on one board. It stands in for the agent-written effect pages (mosaics, LED panels, paint effects) that made the old desktop app pan at 15 frames per second.

## How the old app was measured (2026-09-28)

A headless Chrome script opened the real project with ten page artifacts, fit it to view, then sent wheel events for 4 s to pan back and forth while a `requestAnimationFrame` loop in the app recorded frame gaps and a `PerformanceObserver` counted long tasks.

| Setup | Median frame gap | p95 | Frames over 33 ms | Long tasks in 4 s |
| --- | --- | --- | --- | --- |
| App on `127.0.0.1` served by the engine, as the desktop shell loads it | 66.7 ms | 75 ms | 100 % | 62, 4.0 s total |
| Same build, same board, app opened on `localhost` (frames become cross-site) | 8.3 ms | 9.3 ms | 0.2 % | 0 |
| App on `127.0.0.1`, frames hidden with CSS | 66.7 ms | 75 ms | 100 % | 61 |
| App on `127.0.0.1`, preview origin requests blocked | 8.3 ms | 9.1 ms | 0 % | 0 |
| App on `127.0.0.1`, only the five effect pages loaded | 58.3 ms | 58.9 ms | 100 % | 74 |
| App on `127.0.0.1`, only one effect page loaded | 16.6 ms | 17.2 ms | 0 % | 0 |

Every frame of every page ran at about 17 animation frames per second even with nobody touching the canvas, because they all shared one thread with the canvas.

Two causes, both fixed in the specs: the preview origin was the same site as the app in the desktop shell (ports do not separate sites), and every artifact frame was mounted and running at all times. Spec 09 "Keeping artifacts off the canvas thread" and contract 9 in the index are the fix. The budget tasks measure the same way, in the hosted shape.
