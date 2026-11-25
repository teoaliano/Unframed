import type { TLRecord } from "tldraw";

interface Change {
  readonly before: TLRecord;
  readonly after: TLRecord;
}

type Step = Change[] & { sealed?: boolean };

const KEPT_STEPS = 100;

export class DocHistory {
  private past: Step[] = [];
  private future: Step[] = [];

  record(before: TLRecord, after: TLRecord, label: string | undefined, sealed: boolean): void {
    const last = this.past.at(-1);
    if (label === undefined && last && !last.sealed) last.push({ before, after });
    else {
      const step: Step = [{ before, after }];
      if (sealed) step.sealed = true;
      this.past.push(step);
    }
    if (this.past.length > KEPT_STEPS) this.past.shift();
    this.future = [];
  }

  takeUndo(): TLRecord[] | undefined {
    const step = this.past.pop();
    if (!step) return undefined;
    this.future.push(step);
    return step.map((change) => change.before).reverse();
  }

  takeRedo(): TLRecord[] | undefined {
    const step = this.future.pop();
    if (!step) return undefined;
    this.past.push(step);
    return step.map((change) => change.after);
  }

  dropRedo(): void {
    this.future = [];
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}
