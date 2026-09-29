/**
 * The import report (spec 11): what changed, what was not kept and which files were
 * missing, in the exact sentences the person reads. Every string lives here.
 */
export type ReportSection = "changed" | "notKept" | "missing";

export interface ReportItem {
  readonly section: ReportSection;
  readonly text: string;
}

export interface ImportSource {
  /** The snapshot's `version`; `null` for a legacy, missing or unreadable snapshot. */
  readonly snapshotVersion: number | null;
  readonly journalEntriesApplied: number;
  /** The 1-based line of `graph.log` replay stopped at, when one was not valid JSON. */
  readonly journalStoppedAtLine?: number;
}

export interface ImportCounts {
  readonly prompts: number;
  readonly images: number;
  readonly videos: number;
  readonly groups: number;
  readonly recipeGroups: number;
  readonly results: number;
  readonly pages: number;
  readonly motions: number;
  readonly wiresRemoved: number;
  readonly filesExtracted: number;
}

export interface ImportReport {
  readonly importedAt: string;
  readonly source: ImportSource;
  readonly counts: ImportCounts;
  readonly items: ReadonlyArray<ReportItem>;
  readonly seen: boolean;
}

export type LegacyMedium = "image" | "video" | "text";

const changed = (text: string): ReportItem => ({ section: "changed", text });
const notKept = (text: string): ReportItem => ({ section: "notKept", text });
const missing = (text: string): ReportItem => ({ section: "missing", text });

/** "an image output", "a video output", "a text output". */
const output = (medium: LegacyMedium) => `${medium === "image" ? "an" : "a"} ${medium} output`;

export const reportText = {
  wires: (count: number) => changed(`Wires are gone: the selection is the input now. ${count} wires were removed.`),
  boxed: (id: string, medium: LegacyMedium, sources: number) => changed(`@${id} was ${output(medium)}. It is now a recipe group around its ${sources} sources.`),
  onGroup: (id: string, medium: LegacyMedium, group: string) => changed(`@${id} was ${output(medium)} wired from @${group}. @${group} now holds its settings.`),
  stood: (id: string, medium: LegacyMedium) =>
    changed(
      `@${id} was ${output(medium)} whose sources also fed other outputs, or could not be boxed cleanly. It is now a recipe group where it stood. Select it with its sources to run it.`,
    ),
  unwired: (id: string, medium: LegacyMedium) => changed(`@${id} was ${output(medium)} with no sources. It is now a recipe group where it stood.`),
  answer: (id: string) => changed(`@${id} was a text output. Its answer is now a text result with the same @id.`),
  instructions: (prompt: string) => changed(`Its instructions are now the prompt @${prompt}.`),
  renderTracked: (id: string) => changed(`@${id} had a render in flight. It is still tracked and lands here when it finishes.`),
  orphan: (id: string) => changed(`@${id} belonged to a group that no longer exists. It is now on the canvas at its old offset.`),
  notMember: (id: string) => changed(`@${id} was inside a group but cannot be a member here. It is now beside it.`),
  noAnswer: (id: string) => notKept(`@${id} was a text output with no answer yet. Prompts that mention @${id} now show the token as typed.`),
  runDropped: (id: string) => notKept(`@${id} had a run in flight when the old app last saved. It was not resumed. Any image it finished is in the project folder.`),
  renderFailed: (id: string, error: string) => notKept(`@${id}'s render failed: ${error}`),
  renderUnknown: (id: string) => notKept(`@${id} was waiting for a render the job store no longer knows about. Nothing was resumed.`),
  unknownType: (type: string, id: string) => notKept(`A node of unknown type ${type} (id ${id}) was not imported.`),
  journalStopped: (line: number) => notKept(`graph.log has an unreadable line ${line}. Changes after it were not imported.`),
  snapshotUnreadable: () => notKept("graph.json could not be read, so the canvas was rebuilt from graph.log."),
  chats: () => notKept("Old chats in threads/ are not shown in this version. Their files are still in the project folder."),
  missingFile: (kind: "Image" | "Video" | "Page" | "Motion", id: string, file: string) =>
    missing(`${kind} @${id} named ${file}, which is not in the project folder. It is empty now.`),
  missingResults: (count: number, id: string) => missing(`${count} results of @${id} are no longer in the project folder.`),
};
