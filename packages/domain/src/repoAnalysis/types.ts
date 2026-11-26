export type SourceFiles = ReadonlyMap<string, string>;

export interface SourceAt {
  readonly file: string;
  readonly line: number;
}

export interface CodeStack {
  readonly framework: string;
  readonly router: string;
  readonly language: "ts" | "js";
  readonly styling: ReadonlyArray<string>;
  readonly libraries: ReadonlyArray<string>;
}

export interface CodeRoute {
  readonly path: string;
  readonly file: string;
  readonly line: number;
  readonly params: ReadonlyArray<string>;
  readonly group: string;
  readonly name: string;
  readonly source: "files" | "config";
  readonly layouts: ReadonlyArray<string>;
  readonly entry?: string;
  readonly example?: string;
}

export interface CodeFeature {
  readonly name: string;
  readonly files: ReadonlyArray<string>;
  readonly routes?: ReadonlyArray<string>;
}

export interface CodeDialog extends SourceAt {
  readonly name: string;
}

export interface CodeFlag extends SourceAt {
  readonly name: string;
}

export interface CodeMap {
  readonly version: 1;
  readonly stack: CodeStack;
  readonly routes: ReadonlyArray<CodeRoute>;
  readonly dialogs: ReadonlyArray<CodeDialog>;
  readonly flags: ReadonlyArray<CodeFlag>;
  readonly features: ReadonlyArray<CodeFeature>;
  readonly notes: string;
}

export interface DesignComponent extends SourceAt {
  readonly name: string;
  readonly props: ReadonlyArray<string>;
  readonly variants: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly uses: number;
  readonly usedIn: ReadonlyArray<string>;
}

export type DesignTokenKind = "color" | "radius" | "font" | "spacing" | "shadow" | "other";

export interface DesignToken extends SourceAt {
  readonly name: string;
  readonly value: string;
  readonly kind: DesignTokenKind;
  readonly source: "css" | "tailwind";
}

export interface DesignSystemIndex {
  readonly version: 1;
  readonly components: ReadonlyArray<DesignComponent>;
  readonly tokens: ReadonlyArray<DesignToken>;
}

export type StateCaseKind = "loading" | "error" | "empty" | "role" | "status" | "auth" | "dialog" | "firstrun";

export interface StateCase extends SourceAt {
  readonly kind: StateCaseKind;
  readonly text: string;
  readonly reads: string;
}

export interface PreparedState {
  readonly state: string;
  readonly route: string;
  readonly steps: ReadonlyArray<unknown>;
  readonly mocks: ReadonlyArray<unknown>;
  readonly case?: string;
}

export interface RouteStates {
  readonly route: string;
  readonly files: number;
  readonly cases: ReadonlyArray<StateCase>;
  readonly prepared: ReadonlyArray<PreparedState>;
}

export interface StatesIndex {
  readonly version: 1;
  readonly routes: ReadonlyArray<RouteStates>;
}

export interface RepoAnalysis {
  readonly codeMap: CodeMap;
  readonly designSystem: DesignSystemIndex;
  readonly states: StatesIndex;
}
