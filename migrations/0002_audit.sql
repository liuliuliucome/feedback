CREATE TABLE audit_logs (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX audit_created ON audit_logs(created_at);
CREATE INDEX tickets_assignee ON tickets(assigned_to, status, updated_at);
