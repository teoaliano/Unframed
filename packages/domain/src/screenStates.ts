import { SCREEN_STEP_ACTIONS, type ScreenMock, type ScreenStep, type ScreenTarget } from "@unframed/contracts";

export const SCREEN_STEPS_MAX = 50;
export const SCREEN_MOCKS_MAX = 50;
export const MOCK_DELAY_MAX = 60_000;

export const NO_TARGET = "name the target by its role and name (button Generate), by its visible text, or as a last resort by a CSS selector.";

type Checked<K extends string, V> = { readonly [key in K]: V } | { readonly error: string };

const record = (value: unknown): Record<string, unknown> | undefined => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined);

const filled = (value: unknown): string | undefined => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined);

export const checkTarget = (value: unknown): ScreenTarget | undefined => {
  const raw = record(value);
  if (raw === undefined) return undefined;
  const role = filled(raw.role);
  const name = filled(raw.name);
  const text = filled(raw.text);
  const selector = filled(raw.selector);
  if (role === undefined && text === undefined && selector === undefined) return undefined;
  return { ...(role === undefined ? {} : { role }), ...(role !== undefined && name !== undefined ? { name } : {}), ...(text === undefined ? {} : { text }), ...(selector === undefined ? {} : { selector }) };
};

const checkStep = (value: unknown): ScreenStep | string => {
  const raw = record(value) ?? {};
  const action = raw.action;
  if (typeof action !== "string" || !(SCREEN_STEP_ACTIONS as ReadonlyArray<string>).includes(action)) return `the action is one of ${SCREEN_STEP_ACTIONS.join(", ")}.`;
  if (action === "press") {
    const key = filled(raw.key);
    if (key === undefined) return "a press step needs a key, such as Enter or Escape.";
    if (raw.target === undefined) return { action, key };
    const target = checkTarget(raw.target);
    return target === undefined ? NO_TARGET : { action, key, target };
  }
  const target = checkTarget(raw.target);
  if (target === undefined) return NO_TARGET;
  if (action === "type") {
    if (typeof raw.text !== "string") return "a type step needs the text to type.";
    return { action, target, text: raw.text };
  }
  return { action: action as "click" | "hover" | "wait" | "scroll", target };
};

export const checkSteps = (value: unknown): Checked<"steps", ReadonlyArray<ScreenStep>> => {
  if (value === undefined || value === null) return { steps: [] };
  if (!Array.isArray(value)) return { error: "Steps are a list." };
  if (value.length > SCREEN_STEPS_MAX) return { error: `A state takes at most ${SCREEN_STEPS_MAX} steps.` };
  const steps: ScreenStep[] = [];
  for (const [index, raw] of value.entries()) {
    const step = checkStep(raw);
    if (typeof step === "string") return { error: `Step ${index + 1}: ${step}` };
    steps.push(step);
  }
  return { steps };
};

const METHOD = /^[A-Za-z]{3,10}$/;

const checkMock = (value: unknown): ScreenMock | string => {
  const raw = record(value) ?? {};
  const url = filled(raw.url);
  if (url === undefined) return "name the request's URL pattern, such as /api/items or https://api.example.com/*.";
  let method: string | undefined;
  if (raw.method !== undefined) {
    if (typeof raw.method !== "string" || !METHOD.test(raw.method.trim())) return "the method is an HTTP method such as GET or POST.";
    method = raw.method.trim().toUpperCase();
  }
  const head = { ...(method === undefined ? {} : { method }), url };
  if (raw.fail === true) return { ...head, fail: true };
  const status = raw.status ?? 200;
  if (typeof status !== "number" || !Number.isInteger(status) || status < 100 || status > 599) return "the status is a number from 100 to 599.";
  const delay = raw.delay ?? 0;
  if (typeof delay !== "number" || !Number.isFinite(delay) || delay < 0 || delay > MOCK_DELAY_MAX) return `the delay is a number of milliseconds from 0 to ${MOCK_DELAY_MAX}.`;
  const headers: Record<string, string> = {};
  for (const [name, header] of Object.entries(record(raw.headers) ?? {})) if (typeof header === "string") headers[name.toLowerCase()] = header;
  let body = "";
  if (typeof raw.body === "string") body = raw.body;
  else if (raw.body !== undefined) {
    body = JSON.stringify(raw.body);
    headers["content-type"] ??= "application/json";
  }
  return { ...head, status, headers, body, delay: Math.round(delay) };
};

export const checkMocks = (value: unknown): Checked<"mocks", ReadonlyArray<ScreenMock>> => {
  if (value === undefined || value === null) return { mocks: [] };
  if (!Array.isArray(value)) return { error: "Mocks are a list." };
  if (value.length > SCREEN_MOCKS_MAX) return { error: `A state takes at most ${SCREEN_MOCKS_MAX} mocks.` };
  const mocks: ScreenMock[] = [];
  for (const [index, raw] of value.entries()) {
    const mock = checkMock(raw);
    if (typeof mock === "string") return { error: `Mock ${index + 1}: ${mock}` };
    mocks.push(mock);
  }
  return { mocks };
};

export function matchMock<M extends { readonly method?: string; readonly url: string }>(mocks: ReadonlyArray<M>, request: { readonly method: string; readonly url: string }): M | undefined {
  let parsed: URL;
  try {
    parsed = new URL(request.url);
  } catch {
    return undefined;
  }
  const method = request.method.toUpperCase();
  for (const mock of mocks) {
    if (mock.method !== undefined && mock.method.toUpperCase() !== method) continue;
    const pattern = mock.url;
    const withQuery = pattern.indexOf("?") !== -1;
    const local = pattern.charAt(0) === "/";
    const subject = (local ? "" : parsed.origin) + parsed.pathname + (withQuery ? parsed.search : "");
    const source = pattern
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    if (new RegExp(`^${source}$`).test(subject)) return mock;
  }
  return undefined;
}

export const describeTarget = (target: ScreenTarget): string => {
  if (target.role !== undefined) return target.name === undefined ? target.role : `${target.role} ${target.name}`;
  if (target.text !== undefined) return `"${target.text}"`;
  return target.selector ?? "";
};

export const describeStep = (step: ScreenStep): string => {
  switch (step.action) {
    case "type":
      return `type "${step.text}" into ${describeTarget(step.target)}`;
    case "press":
      return step.target === undefined ? `press ${step.key}` : `press ${step.key} in ${describeTarget(step.target)}`;
    case "wait":
      return `wait for ${describeTarget(step.target)}`;
    case "scroll":
      return `scroll to ${describeTarget(step.target)}`;
    default:
      return `${step.action} ${describeTarget(step.target)}`;
  }
};

export const screenLabel = (input: { readonly branch: string; readonly route: string; readonly state?: string | undefined }): string => {
  const where = input.state?.trim() || input.route;
  return input.branch === "" ? where : `${input.branch} · ${where}`;
};

export const branchChip = (input: { readonly branch: string; readonly changes: number }): { readonly name: string; readonly count: string | undefined; readonly label: string; readonly changes: string } =>
  input.changes > 0
    ? { name: input.branch, count: String(input.changes), label: `Branch ${input.branch}, ${input.changes} changed ${input.changes === 1 ? "file" : "files"}`, changes: `Changes (${input.changes})` }
    : { name: input.branch, count: undefined, label: `Branch ${input.branch}`, changes: "Changes" };
