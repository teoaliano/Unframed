import type { DatabaseSync } from "node:sqlite";

/**
 * The chat store's tables in the project database (spec 07): t3code's orchestration tables,
 * trimmed, plus `turn_changes`. Persisted events must stay decodable forever, so a later
 * change adds optional columns and never renames.
 */
export const createChatTables = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE orchestration_events (
      sequence INTEGER PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE,
      aggregate_kind TEXT NOT NULL,
      stream_id TEXT NOT NULL,
      stream_version INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      command_id TEXT,
      causation_event_id TEXT,
      correlation_id TEXT,
      actor_kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      UNIQUE (stream_id, stream_version)
    );
    CREATE INDEX idx_orchestration_events_stream ON orchestration_events(stream_id, sequence);
    CREATE TABLE orchestration_command_receipts (
      command_id TEXT PRIMARY KEY,
      aggregate_id TEXT NOT NULL,
      accepted_at TEXT NOT NULL,
      result_sequence INTEGER,
      status TEXT NOT NULL,
      error TEXT
    );
    CREATE TABLE provider_session_runtime (
      thread_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      runtime_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      resume_cursor_json TEXT
    );
    CREATE TABLE projection_threads (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      titled_by TEXT,
      tags_json TEXT NOT NULL,
      model_selection_json TEXT NOT NULL,
      runtime_mode TEXT NOT NULL,
      interaction_mode TEXT NOT NULL,
      last_clock INTEGER,
      latest_turn_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE projection_thread_messages (
      message_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      is_streaming INTEGER NOT NULL,
      attachments_json TEXT,
      context_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, message_id)
    );
    CREATE TABLE projection_thread_activities (
      activity_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      tone TEXT NOT NULL,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, activity_id)
    );
    CREATE TABLE projection_thread_sessions (
      thread_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      provider TEXT NOT NULL,
      active_turn_id TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE projection_turns (
      thread_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      turn_count INTEGER NOT NULL,
      pending_message_id TEXT,
      assistant_message_id TEXT,
      state TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      usage_json TEXT,
      files_json TEXT,
      reverted_json TEXT,
      PRIMARY KEY (thread_id, turn_id)
    );
    CREATE TABLE projection_pending_approvals (
      request_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      status TEXT NOT NULL,
      decision TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE TABLE projection_thread_proposed_plans (
      plan_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      plan_markdown TEXT NOT NULL,
      implemented_at TEXT,
      implementation_thread_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE projection_state (
      projector TEXT PRIMARY KEY,
      last_applied_sequence INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE turn_changes (
      chat_id TEXT NOT NULL,
      turn INTEGER NOT NULL,
      shape_id TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      before_file TEXT,
      after_file TEXT,
      first_clock INTEGER NOT NULL,
      last_clock INTEGER NOT NULL,
      PRIMARY KEY (chat_id, turn, shape_id)
    );
  `);
};
