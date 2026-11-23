export const INSTANCE_IDLE_MS = 10 * 60 * 1000;
const BUDGET_SHARE = 0.25;

export const instanceMemoryBudget = (totalMemoryBytes: number): number => Math.floor(totalMemoryBytes * BUDGET_SHARE);

export interface RunningInstance {
  readonly id: string;
  readonly rss: number;
  readonly lastDemandedAt: number;
  readonly demanded: boolean;
}

export const evictionsOverBudget = (running: ReadonlyArray<RunningInstance>, budget: number): string[] => {
  let total = running.reduce((sum, instance) => sum + instance.rss, 0);
  if (total <= budget) return [];
  const byRecency = (a: RunningInstance, b: RunningInstance) => a.lastDemandedAt - b.lastDemandedAt;
  const idle = running.filter((instance) => !instance.demanded).sort(byRecency);
  const demanded = running.filter((instance) => instance.demanded).sort(byRecency).slice(0, -1);
  const stopped: string[] = [];
  for (const instance of [...idle, ...demanded]) {
    if (total <= budget) break;
    stopped.push(instance.id);
    total -= instance.rss;
  }
  return stopped;
};

export const idleToStop = (input: {
  readonly demanded: boolean;
  readonly lastDemandedAt: number;
  readonly lastChangeAt: number;
  readonly now: number;
  readonly idleMs: number;
}): boolean => !input.demanded && input.now - Math.max(input.lastDemandedAt, input.lastChangeAt) >= input.idleMs;

export interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
  readonly rssKb: number;
}

export const parseProcessTable = (output: string): ProcessRow[] =>
  output.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line);
    return match === null ? [] : [{ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), rssKb: Number(match[4]) }];
  });

export const processTreeRss = (rows: ReadonlyArray<ProcessRow>, root: number): number => {
  const members = new Set(rows.filter((row) => row.pid === root || row.pgid === root).map((row) => row.pid));
  for (let grew = true; grew; ) {
    grew = false;
    for (const row of rows) {
      if (!members.has(row.pid) && members.has(row.ppid)) {
        members.add(row.pid);
        grew = true;
      }
    }
  }
  return rows.reduce((sum, row) => (members.has(row.pid) ? sum + row.rssKb * 1024 : sum), 0);
};
