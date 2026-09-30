import type { DatabaseSync } from "node:sqlite";
import type { ImportReport } from "@unframed/domain";

/** Spec 11's one row: the report of the import that made this database. A project never imported has none. */
export const createLegacyImportReportTable = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE legacy_import_report (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      report TEXT NOT NULL,
      seen INTEGER NOT NULL DEFAULT 0
    );
  `);
};

export const writeImportReport = (db: DatabaseSync, report: ImportReport): void => {
  const { seen, ...rest } = report;
  db.prepare("INSERT INTO legacy_import_report (id, report, seen) VALUES (1, ?, ?)").run(JSON.stringify(rest), seen ? 1 : 0);
};

export const readImportReport = (db: DatabaseSync): ImportReport | null => {
  const row = db.prepare("SELECT report, seen FROM legacy_import_report WHERE id = 1").get();
  if (!row) return null;
  return { ...(JSON.parse(String(row.report)) as Omit<ImportReport, "seen">), seen: Number(row.seen) === 1 };
};

export const markImportReportSeen = (db: DatabaseSync): void => {
  db.prepare("UPDATE legacy_import_report SET seen = 1 WHERE id = 1").run();
};
