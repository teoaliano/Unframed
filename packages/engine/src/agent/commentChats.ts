import type { DatabaseSync } from "node:sqlite";

export const createCommentChatsTable = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE comment_chats (
      thread_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      PRIMARY KEY (thread_id, provider)
    );
  `);
};

export class CommentChats {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  get(threadId: string, provider: string): string | undefined {
    const row = this.db.prepare("SELECT chat_id FROM comment_chats WHERE thread_id = ? AND provider = ?").get(threadId, provider);
    return row === undefined ? undefined : String(row.chat_id);
  }

  set(threadId: string, provider: string, chatId: string): void {
    this.db.prepare("INSERT OR REPLACE INTO comment_chats (thread_id, provider, chat_id) VALUES (?, ?, ?)").run(threadId, provider, chatId);
  }
}
