/**
 * The motion editor's transport (spec 21): what the strip's buttons and keys do to the motion's
 * player, and the clock that moves the playhead and the readout without React (Studio's live-time
 * pattern). The player lives in the viewer, across origins, so every change is a message and every
 * time comes back as one. Between messages the clock moves the time on by the elapsed time.
 */
import { FRAME_RATE, frameOf, readout } from "@unframed/domain";

/** The speeds the speed menu offers. */
export const SPEEDS = [0.25, 0.5, 1, 1.5, 2] as const;

/** The fastest a J or L shuttle goes (spec 21: 1x, 2x, then 4x). */
const SHUTTLE_LIMIT = 4;

/** Playback the person starts is trusted over the player's paused reports for this long, while the player starts. */
const START_GRACE_MS = 400;

/** Where a key came from: the frame (forwarded in Edit mode), the strip's time area, or the page body. */
export type TransportZone = "frame" | "strip" | "body";

/** What React draws from: the controls' state, not the time. */
export interface TransportSnapshot {
  readonly playing: boolean;
  readonly speed: number;
  readonly muted: boolean;
  readonly loop: boolean;
  /** The motion's length in seconds, from the viewer's timeline message; zero until it arrives. */
  readonly length: number;
  /** The loop range in seconds (In and Out), kept for the session. Null when a side is not set. */
  readonly range: { readonly start: number | null; readonly end: number | null };
  /** The shuttle's signed rate while J or L is running it: negative backward, positive forward. Undefined otherwise. */
  readonly shuttle: number | undefined;
}

type Send = (message: unknown) => void;
type Painter = (time: number, length: number) => void;

export class MotionTransport {
  private send: Send = () => undefined;
  private painter: Painter | undefined;
  private snap: TransportSnapshot = { playing: false, speed: 1, muted: true, loop: false, length: 0, range: { start: null, end: null }, shuttle: undefined };
  private readonly listeners = new Set<() => void>();
  // The last time the viewer reported, and when; while playing the clock moves on from it.
  private base = 0;
  private baseAt = 0;
  private expectPlay = 0;
  private frameRequest: number | undefined;
  // The settings go to the player once per connection and document: the runtime posts its timeline again whenever its manifest moves (a seek does that),
  // and a rate message would end a running shuttle.
  private pendingSync = false;

  /** Points the transport at the frame: the viewer's control messages go there. */
  connect = (send: Send): void => {
    this.send = send;
    this.pendingSync = true;
    this.sync();
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): TransportSnapshot => this.snap;

  /** Where the time is drawn: the strip's playhead and readout. Drawn at once, and on every move. */
  setPainter = (painter: Painter | undefined): void => {
    this.painter = painter;
    this.paint();
  };

  /** Draws the time again, for a change of the strip that moves the playhead (its width, its zoom). */
  repaint = (): void => this.paint();

  /** The time now, moved on from the last report while playing and kept inside the motion. */
  current = (at = performance.now()): number => {
    const moved = this.snap.playing ? this.moveRate() * ((at - this.baseAt) / 1000) : 0;
    const time = this.base + moved;
    return this.snap.length > 0 ? Math.min(this.snap.length, Math.max(0, time)) : Math.max(0, time);
  };

  /** A message the viewer relayed from the player: its state (time and play state) or its timeline (length). */
  onPlayerMessage = (message: unknown): void => {
    if (typeof message !== "object" || message === null) return;
    const data = message as { type?: unknown; time?: unknown; playing?: unknown; ended?: unknown; duration?: unknown };
    if (data.type === "unframed:player:timeline") {
      const length = typeof data.duration === "number" && Number.isFinite(data.duration) && data.duration > 0 ? data.duration : 0;
      this.update({ length });
      // A new document: its player has none of the transport's settings yet.
      if (this.pendingSync) {
        this.pendingSync = false;
        this.sync();
      }
      this.paint();
      return;
    }
    if (data.type !== "unframed:player:state" || typeof data.time !== "number" || !Number.isFinite(data.time)) return;
    const now = performance.now();
    this.base = data.time;
    this.baseAt = now;
    // The player's own report says whether it plays, except while a shuttle runs (the player is paused under it)
    // and while a start the person made is still on its way.
    if (typeof data.playing === "boolean" && this.snap.shuttle === undefined && (now >= this.expectPlay || data.playing)) {
      this.update({ playing: data.playing && data.ended !== true });
    }
    this.paint();
    this.scheduleTick();
  };

  togglePlay = (): void => {
    if (this.snap.playing) this.pause();
    else this.play();
  };

  play = (): void => {
    if (this.snap.playing) return;
    const now = performance.now();
    this.base = this.current(now);
    this.baseAt = now;
    this.expectPlay = now + START_GRACE_MS;
    this.send({ type: "unframed:player:control", action: "rate", rate: this.snap.speed });
    this.send({ type: "unframed:player:control", action: "play" });
    this.update({ playing: true, shuttle: undefined });
    this.scheduleTick();
  };

  pause = (): void => {
    if (!this.snap.playing) return;
    const now = performance.now();
    this.base = this.current(now);
    this.baseAt = now;
    this.send({ type: "unframed:player:control", action: "pause" });
    this.update({ playing: false, shuttle: undefined });
    this.paint();
  };

  /** Lands on a time. A commit seek leaves the motion paused, as the player's seek does. */
  seek = (seconds: number, mode: "drag" | "commit" = "commit"): void => {
    const time = this.clampToLength(seconds);
    this.base = time;
    this.baseAt = performance.now();
    this.send({ type: "unframed:player:control", action: "seek", seconds: time, mode });
    if (mode === "commit") this.update({ playing: false, shuttle: undefined });
    this.paint();
  };

  /** One frame (or ten) from the frame the playhead is in: the transport pauses first. */
  step = (frames: number): void => {
    this.pause();
    const frame = Math.max(0, frameOf(this.current()) + frames);
    this.seek(frame / FRAME_RATE);
  };

  /** J (backward) and L (forward): 1x, then 2x, then 4x, each press while the shuttle runs the same way. */
  shuttle = (direction: 1 | -1): void => {
    const running = this.snap.shuttle;
    const magnitude = running !== undefined && Math.sign(running) === direction ? Math.min(SHUTTLE_LIMIT, Math.abs(running) * 2) : 1;
    const rate = direction * magnitude;
    const now = performance.now();
    this.base = this.current(now);
    this.baseAt = now;
    // Forward the player plays at the shuttle's rate; backward the viewer seeks each frame, since the player plays forward only.
    if (rate > 0) {
      this.send({ type: "unframed:player:control", action: "rate", rate });
      this.send({ type: "unframed:player:control", action: "play" });
    } else {
      this.send({ type: "unframed:player:control", action: "rate", rate });
    }
    this.update({ playing: true, shuttle: rate });
    this.scheduleTick();
  };

  /** K: pauses and ends the shuttle, so the next Space plays at the chosen speed. */
  stopShuttle = (): void => {
    if (this.snap.shuttle === undefined && !this.snap.playing) return;
    const now = performance.now();
    this.base = this.current(now);
    this.baseAt = now;
    this.send({ type: "unframed:player:control", action: "pause" });
    this.send({ type: "unframed:player:control", action: "rate", rate: this.snap.speed });
    this.update({ playing: false, shuttle: undefined });
    this.paint();
  };

  setSpeed = (speed: number): void => {
    if (this.snap.playing && this.snap.shuttle === undefined) {
      const now = performance.now();
      this.base = this.current(now);
      this.baseAt = now;
    }
    // The player takes its rate at once, so a paused change is there when the person plays. A running shuttle keeps its own rate.
    if (this.snap.shuttle === undefined) this.send({ type: "unframed:player:control", action: "rate", rate: speed });
    this.update({ speed });
  };

  setMuted = (muted: boolean): void => {
    this.send({ type: "unframed:player:control", action: "mute", muted });
    this.update({ muted });
  };

  /** The composition's own length, set while the end marker is dragged, so playback and the frame follow it (spec 21, Total length). */
  setRootDuration = (seconds: number): void => {
    this.send({ type: "unframed:player:control", action: "root-duration", seconds });
  };

  setLoop = (loop: boolean): void => {
    this.update({ loop });
    this.sendRange();
  };

  /** The loop range's In at the playhead, or Out. An In at or past the Out, or an Out at or before the In, is refused. */
  setIn = (seconds: number): void => {
    const { range } = this.snap;
    if (range.end !== null && seconds >= range.end) return;
    this.update({ range: { ...range, start: seconds } });
    this.sendRange();
  };

  setOut = (seconds: number): void => {
    const { range } = this.snap;
    if (range.start !== null && seconds <= range.start) return;
    this.update({ range: { ...range, end: seconds } });
    this.sendRange();
  };

  clearRange = (side: "in" | "out"): void => {
    const { range } = this.snap;
    this.update({ range: side === "in" ? { ...range, start: null } : { ...range, end: null } });
    this.sendRange();
  };

  /**
   * A key the strip or the frame forwarded (spec 21): Space plays and pauses; Left and Right step a frame (Shift, ten);
   * J and L shuttle; K stops the shuttle; M mutes; Shift+L loops; and I and O set the loop range, Shift clearing it, but
   * only in the strip, since I is Interact everywhere else and O does nothing there. Returns whether the transport took it.
   */
  handleKey = (key: string, modifiers: { readonly shift: boolean; readonly meta: boolean; readonly ctrl: boolean }, zone: TransportZone): boolean => {
    if (modifiers.meta || modifiers.ctrl) return false;
    const lower = key.toLowerCase();
    if (key === " ") {
      this.togglePlay();
      return true;
    }
    if (key === "ArrowLeft" || key === "ArrowRight") {
      this.step((key === "ArrowLeft" ? -1 : 1) * (modifiers.shift ? 10 : 1));
      return true;
    }
    if (lower === "m") {
      this.setMuted(!this.snap.muted);
      return true;
    }
    if (lower === "j") {
      this.shuttle(-1);
      return true;
    }
    if (lower === "k") {
      this.stopShuttle();
      return true;
    }
    if (lower === "l") {
      if (modifiers.shift) this.setLoop(!this.snap.loop);
      else this.shuttle(1);
      return true;
    }
    if ((lower === "i" || lower === "o") && zone === "strip") {
      const at = this.current();
      if (lower === "i") {
        if (modifiers.shift) this.clearRange("in");
        else this.setIn(at);
      } else if (modifiers.shift) this.clearRange("out");
      else this.setOut(at);
      return true;
    }
    return false;
  };

  dispose = (): void => {
    if (this.frameRequest !== undefined) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = undefined;
    this.listeners.clear();
    this.painter = undefined;
  };

  /** The signed rate the clock moves at: the shuttle's while one runs, else the chosen speed forward. */
  private moveRate(): number {
    return this.snap.shuttle ?? this.snap.speed;
  }

  private clampToLength(seconds: number): number {
    const time = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    return this.snap.length > 0 ? Math.min(this.snap.length, time) : time;
  }

  /** The settings the player should have: the speed, the mute, the range and the loop. Sent when a document loads. */
  private sync(): void {
    this.send({ type: "unframed:player:control", action: "rate", rate: this.snap.speed });
    this.send({ type: "unframed:player:control", action: "mute", muted: this.snap.muted });
    this.sendRange();
  }

  private sendRange(): void {
    this.send({ type: "unframed:player:control", action: "range", start: this.snap.range.start, end: this.snap.range.end, loop: this.snap.loop });
  }

  private update(patch: Partial<TransportSnapshot>): void {
    const next = { ...this.snap, ...patch };
    if (Object.keys(patch).every((key) => Object.is(next[key as keyof TransportSnapshot], this.snap[key as keyof TransportSnapshot]))) return;
    this.snap = next;
    for (const listener of this.listeners) listener();
  }

  private paint(): void {
    this.painter?.(this.current(), this.snap.length);
  }

  /** One frame of the clock while playing: the time is drawn, outside React, and the next frame is asked for. */
  private scheduleTick(): void {
    if (!this.snap.playing || this.frameRequest !== undefined) return;
    this.frameRequest = requestAnimationFrame(() => {
      this.frameRequest = undefined;
      // A backward shuttle stops at the start: the viewer clamps there, and the transport ends the run with it.
      if (this.snap.shuttle !== undefined && this.snap.shuttle < 0 && this.current() <= 0) {
        this.stopShuttle();
        return;
      }
      this.paint();
      this.scheduleTick();
    });
  }
}

/** The readout's two parts: `m:ss.cc / m:ss.cc` and the frame. */
export const readoutParts = (time: number, length: number): { readonly clock: string; readonly frame: string } => ({
  clock: `${readout(time)} / ${readout(length)}`,
  frame: `${frameOf(time)}f`,
});
