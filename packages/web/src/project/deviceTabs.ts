import { followTabs, type FollowState } from "@unframed/domain";
import type { EngineConnection } from "../rpc/engine.ts";
import { TABS_KEY, type ProjectActivation } from "./activation.ts";

interface MacTabs {
  readonly order: ReadonlyArray<string>;
  readonly active: string | undefined;
}

const macTabsOf = (value: unknown): MacTabs => {
  const saved = (value ?? {}) as { order?: unknown; active?: unknown };
  return {
    order: Array.isArray(saved.order) ? saved.order.filter((name): name is string => typeof name === "string") : [],
    active: typeof saved.active === "string" ? saved.active : undefined,
  };
};

export class DeviceTabs {
  private readonly activation: ProjectActivation;
  private readonly engine: EngineConnection;
  private follow: FollowState = { kind: "following" };
  private mac: MacTabs = { order: [], active: undefined };
  private seen = false;
  private macActive: string | undefined;

  constructor(activation: ProjectActivation, engine: EngineConnection) {
    this.activation = activation;
    this.engine = engine;
  }

  start(): () => void {
    this.activation.setDeviceHooks({ choose: (name) => this.choose(name), reload: () => this.apply() });
    return this.engine.subscribe("preferences.subscribe", { keys: [TABS_KEY] }, (change) => {
      if (change.key !== TABS_KEY) return;
      this.read(change.value);
    });
  }

  private read(value: unknown): void {
    this.mac = macTabsOf(value);
    if (!this.seen || this.mac.active !== this.macActive) {
      this.seen = true;
      this.macActive = this.mac.active;
      if (this.mac.active !== undefined) this.follow = followTabs(this.follow, { type: "macActive", project: this.mac.active });
    }
    void this.apply();
  }

  private choose(name: string): void {
    this.follow = followTabs(this.follow, { type: "localChoice", project: name });
    void this.apply();
  }


  private apply(): Promise<void> {
    const follow = this.follow;
    const order =
      follow.kind === "detached" && !this.mac.order.includes(follow.project) ? [...this.mac.order, follow.project] : [...this.mac.order];
    return this.activation.showTabs(order, follow.kind === "following" ? this.mac.active : follow.project);
  }
}
