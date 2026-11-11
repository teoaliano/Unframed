import { FRAME_RATE, frameOf, readout } from "@unframed/domain";

export const SPEEDS = [0.25, 0.5, 1, 1.5, 2] as const;

const SHUTTLE_LIMIT = 4;

const START_GRACE_MS = 400;

const SEEK_TOLERANCE = 0.5 / FRAME_RATE;
const SEEK_SETTLE_MS = 500;

export type TransportZone = "frame" | "strip" | "body";

export interface TransportSnapshot {
  readonly playing: boolean;
  readonly speed: number;
  readonly muted: boolean;
  readonly loop: boolean;
  readonly length: number;
  readonly range: { readonly start: number | null; readonly end: number | null };
  readonly shuttle: number | undefined;
}

type Send = (message: unknown) => void;
type Painter = (time: number, length: number) => void;

export class MotionTransport {
  private send: Send = () => undefined;
  private painter: Painter | undefined;
  private snap: TransportSnapshot = { playing: false, speed: 1, muted: true, loop: false, length: 0, range: { start: null, end: null }, shuttle: undefined };
  private readonly listeners = new Set<() => void>();
  private base = 0;
  private baseAt = 0;
  private seeking: { time: number; at: number } | undefined;
  private expectPlay = 0;
  private frameRequest: number | undefined;
  private pendingSync = false;
  private shown = false;
  private carried: { readonly time: number; readonly playing: boolean } | undefined;
  private wantsPlay = false;

  connect = (send: Send): void => {
    if (this.shown) this.carried = { time: this.current(), playing: this.wantsPlay };
    this.shown = true;
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

  setPainter = (painter: Painter | undefined): void => {
    this.painter = painter;
    this.paint();
  };

  repaint = (): void => this.paint();

  current = (at = performance.now()): number => {
    const moved = this.snap.playing ? this.moveRate() * ((at - this.baseAt) / 1000) : 0;
    const time = this.base + moved;
    return this.snap.length > 0 ? Math.min(this.snap.length, Math.max(0, time)) : Math.max(0, time);
  };

  onPlayerMessage = (message: unknown): void => {
    if (typeof message !== "object" || message === null) return;
    const data = message as { type?: unknown; time?: unknown; playing?: unknown; ended?: unknown; duration?: unknown };
    if (data.type === "unframed:player:timeline") {
      const length = typeof data.duration === "number" && Number.isFinite(data.duration) && data.duration > 0 ? data.duration : 0;
      this.update({ length });
      if (this.pendingSync) {
        this.pendingSync = false;
        this.sync();
      }
      const carried = this.carried;
      if (carried !== undefined) {
        this.carried = undefined;
        this.seek(carried.time, "commit");
        if (carried.playing) this.play();
      }
      this.paint();
      return;
    }
    if (data.type !== "unframed:player:state" || typeof data.time !== "number" || !Number.isFinite(data.time)) return;
    if (this.carried !== undefined) return;
    const now = performance.now();
    if (this.seeking !== undefined) {
      if (Math.abs(data.time - this.seeking.time) <= SEEK_TOLERANCE || now - this.seeking.at > SEEK_SETTLE_MS) this.seeking = undefined;
      else return;
    }
    this.base = data.time;
    this.baseAt = now;
    if (data.ended === true) this.wantsPlay = false;
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
    this.wantsPlay = true;
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
    this.wantsPlay = false;
    if (!this.snap.playing) return;
    const now = performance.now();
    this.base = this.current(now);
    this.baseAt = now;
    this.send({ type: "unframed:player:control", action: "pause" });
    this.update({ playing: false, shuttle: undefined });
    this.paint();
  };

  seek = (seconds: number, mode: "drag" | "commit" = "commit"): void => {
    const time = this.clampToLength(seconds);
    this.base = time;
    this.baseAt = performance.now();
    this.send({ type: "unframed:player:control", action: "seek", seconds: time, mode });
    if (mode === "commit") {
      this.seeking = { time, at: this.baseAt };
      this.wantsPlay = false;
      this.update({ playing: false, shuttle: undefined });
    }
    this.paint();
  };

  step = (frames: number): void => {
    const from = this.seeking?.time ?? this.current();
    this.pause();
    const frame = Math.max(0, frameOf(from) + frames);
    this.seek(frame / FRAME_RATE);
  };

  shuttle = (direction: 1 | -1): void => {
    const running = this.snap.shuttle;
    const magnitude = running !== undefined && Math.sign(running) === direction ? Math.min(SHUTTLE_LIMIT, Math.abs(running) * 2) : 1;
    const rate = direction * magnitude;
    const now = performance.now();
    this.base = this.current(now);
    this.baseAt = now;
    if (rate > 0) {
      this.send({ type: "unframed:player:control", action: "rate", rate });
      this.send({ type: "unframed:player:control", action: "play" });
    } else {
      this.send({ type: "unframed:player:control", action: "rate", rate });
    }
    this.wantsPlay = true;
    this.update({ playing: true, shuttle: rate });
    this.scheduleTick();
  };

  stopShuttle = (): void => {
    if (this.snap.shuttle === undefined && !this.snap.playing) return;
    const now = performance.now();
    this.base = this.current(now);
    this.baseAt = now;
    this.send({ type: "unframed:player:control", action: "pause" });
    this.send({ type: "unframed:player:control", action: "rate", rate: this.snap.speed });
    this.wantsPlay = false;
    this.update({ playing: false, shuttle: undefined });
    this.paint();
  };

  setSpeed = (speed: number): void => {
    if (this.snap.playing && this.snap.shuttle === undefined) {
      const now = performance.now();
      this.base = this.current(now);
      this.baseAt = now;
    }
    if (this.snap.shuttle === undefined) this.send({ type: "unframed:player:control", action: "rate", rate: speed });
    this.update({ speed });
  };

  setMuted = (muted: boolean): void => {
    this.send({ type: "unframed:player:control", action: "mute", muted });
    this.update({ muted });
  };

  setRootDuration = (seconds: number): void => {
    this.send({ type: "unframed:player:control", action: "root-duration", seconds });
  };

  setLoop = (loop: boolean): void => {
    this.update({ loop });
    this.sendRange();
  };

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

  private moveRate(): number {
    return this.snap.shuttle ?? this.snap.speed;
  }

  private clampToLength(seconds: number): number {
    const time = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    return this.snap.length > 0 ? Math.min(this.snap.length, time) : time;
  }

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

  private scheduleTick(): void {
    if (!this.snap.playing || this.frameRequest !== undefined) return;
    this.frameRequest = requestAnimationFrame(() => {
      this.frameRequest = undefined;
      if (this.snap.shuttle !== undefined && this.snap.shuttle < 0 && this.current() <= 0) {
        this.stopShuttle();
        return;
      }
      this.paint();
      this.scheduleTick();
    });
  }
}

export const readoutParts = (time: number, length: number): { readonly clock: string; readonly frame: string } => ({
  clock: `${readout(time)} / ${readout(length)}`,
  frame: `${frameOf(time)}f`,
});
