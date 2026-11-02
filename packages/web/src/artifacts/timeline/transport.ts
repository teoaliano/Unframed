/**
 * The motion editor's transport (spec 21): what the strip's buttons and keys do to the motion's
 * player, and the clock that moves the playhead and the readout without React (Studio's live-time
 * pattern). The player lives in the viewer, across origins, so every change is a message and every
 * time comes back as one. Between messages the clock moves the time on by the elapsed time.
 */
import { FRAME_RATE, frameOf, readout } from "@unframed/domain";

/** The speeds the speed menu offers. */
export const SPEEDS = [0.25, 0.5, 1, 1.5, 2] as const;

/** Playback the person starts is trusted over the player's paused reports for this long, while the player starts. */
const START_GRACE_MS = 400;

/** What React draws from: the controls' state, not the time. */
export interface TransportSnapshot {
  readonly playing: boolean;
  readonly speed: number;
  readonly muted: boolean;
  readonly loop: boolean;
  /** The motion's length in seconds, from the viewer's timeline message; zero until it arrives. */
  readonly length: number;
}

type Send = (message: unknown) => void;
type Painter = (time: number, length: number) => void;

export class MotionTransport {
  private send: Send = () => undefined;
  private painter: Painter | undefined;
  private snap: TransportSnapshot = { playing: false, speed: 1, muted: true, loop: false, length: 0 };
  private readonly listeners = new Set<() => void>();
  // The last time the viewer reported, and when; while playing the clock moves on from it.
  private base = 0;
  private baseAt = 0;
  private expectPlay = 0;
  private frameRequest: number | undefined;

  /** Points the transport at the frame: the viewer's control messages go there. */
  connect = (send: Send): void => {
    this.send = send;
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
    const moved = this.snap.playing ? this.snap.speed * ((at - this.baseAt) / 1000) : 0;
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
      this.sync();
      this.paint();
      return;
    }
    if (data.type !== "unframed:player:state" || typeof data.time !== "number" || !Number.isFinite(data.time)) return;
    const now = performance.now();
    this.base = data.time;
    this.baseAt = now;
    // The player's own report says whether it plays, except while a start the person made is still on its way.
    if (typeof data.playing === "boolean" && (now >= this.expectPlay || data.playing)) this.update({ playing: data.playing && data.ended !== true });
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
    this.update({ playing: true });
    this.scheduleTick();
  };

  pause = (): void => {
    if (!this.snap.playing) return;
    const now = performance.now();
    this.base = this.current(now);
    this.baseAt = now;
    this.send({ type: "unframed:player:control", action: "pause" });
    this.update({ playing: false });
    this.paint();
  };

  /** Lands on a time. A commit seek leaves the motion paused, as the player's seek does. */
  seek = (seconds: number, mode: "drag" | "commit" = "commit"): void => {
    const time = this.clampToLength(seconds);
    this.base = time;
    this.baseAt = performance.now();
    this.send({ type: "unframed:player:control", action: "seek", seconds: time, mode });
    if (mode === "commit") this.update({ playing: false });
    this.paint();
  };

  /** One frame (or ten) from the frame the playhead is in: the transport pauses first. */
  step = (frames: number): void => {
    this.pause();
    const frame = Math.max(0, frameOf(this.current()) + frames);
    this.seek(frame / FRAME_RATE);
  };

  setSpeed = (speed: number): void => {
    if (this.snap.playing) {
      const now = performance.now();
      this.base = this.current(now);
      this.baseAt = now;
    }
    // The player takes its rate at once, so a paused change is there when the person plays.
    this.send({ type: "unframed:player:control", action: "rate", rate: speed });
    this.update({ speed });
  };

  setMuted = (muted: boolean): void => {
    this.send({ type: "unframed:player:control", action: "mute", muted });
    this.update({ muted });
  };

  setLoop = (loop: boolean): void => {
    this.send({ type: "unframed:player:control", action: "range", start: null, end: null, loop });
    this.update({ loop });
  };

  /**
   * A key the strip or the frame forwarded: Space plays and pauses, Left and Right step a frame
   * (Shift with them, ten), and M mutes. Only the zone the focus is in decides whether the transport
   * takes it; the caller says so.
   */
  handleKey = (key: string, modifiers: { readonly shift: boolean; readonly meta: boolean; readonly ctrl: boolean }): boolean => {
    if (modifiers.meta || modifiers.ctrl) return false;
    if (key === " ") {
      this.togglePlay();
      return true;
    }
    if (key === "ArrowLeft" || key === "ArrowRight") {
      this.step((key === "ArrowLeft" ? -1 : 1) * (modifiers.shift ? 10 : 1));
      return true;
    }
    if (key === "m" || key === "M") {
      this.setMuted(!this.snap.muted);
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

  private clampToLength(seconds: number): number {
    const time = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    return this.snap.length > 0 ? Math.min(this.snap.length, time) : time;
  }

  /** The settings the player should have: the speed, the mute and the loop. Sent when a document loads. */
  private sync(): void {
    this.send({ type: "unframed:player:control", action: "rate", rate: this.snap.speed });
    this.send({ type: "unframed:player:control", action: "mute", muted: this.snap.muted });
    this.send({ type: "unframed:player:control", action: "range", start: null, end: null, loop: this.snap.loop });
  }

  private update(patch: Partial<TransportSnapshot>): void {
    const next = { ...this.snap, ...patch };
    if (Object.keys(patch).every((key) => next[key as keyof TransportSnapshot] === this.snap[key as keyof TransportSnapshot])) return;
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
