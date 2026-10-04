CREATE TABLE notes (
  path TEXT PRIMARY KEY, sha TEXT NOT NULL, source_commit TEXT NOT NULL,
  title TEXT NOT NULL, content TEXT NOT NULL, properties TEXT NOT NULL,
  tags TEXT NOT NULL, aliases TEXT NOT NULL, date TEXT, date_source TEXT,
  indexed_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE chunks (
  id TEXT PRIMARY KEY, path TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,
  heading TEXT NOT NULL, content TEXT NOT NULL, line_start INTEGER NOT NULL, line_end INTEGER NOT NULL
);
CREATE INDEX chunks_path ON chunks(path);
CREATE VIRTUAL TABLE chunks_fts USING fts5(id UNINDEXED, path, heading, content, metadata, tokenize='unicode61');
CREATE TRIGGER chunks_insert AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(id,path,heading,content,metadata) VALUES (new.id,new.path,new.heading,new.content,(SELECT title||' '||properties||' '||tags||' '||aliases FROM notes WHERE path=new.path));
END;
CREATE TRIGGER chunks_delete AFTER DELETE ON chunks BEGIN DELETE FROM chunks_fts WHERE id=old.id; END;
CREATE TABLE links (source TEXT NOT NULL, target TEXT NOT NULL, PRIMARY KEY(source,target));
CREATE INDEX links_target ON links(target);
CREATE TABLE raw_links (source TEXT NOT NULL, target TEXT NOT NULL, PRIMARY KEY(source,target));
CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE index_errors (path TEXT PRIMARY KEY, sha TEXT NOT NULL, error TEXT NOT NULL, attempted_at TEXT NOT NULL);
CREATE TABLE vector_gc (id TEXT PRIMARY KEY);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
