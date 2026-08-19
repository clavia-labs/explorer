PRAGMA foreign_keys = ON;

CREATE TABLE objects (
  object_sha256 TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE datasets (
  dataset_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  object_sha256 TEXT NOT NULL,
  manifest_json TEXT NOT NULL
);

CREATE TABLE dataset_traces (
  dataset_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  object_sha256 TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  PRIMARY KEY (dataset_id, trace_id),
  FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id)
);

CREATE TABLE views (
  view_id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  object_sha256 TEXT NOT NULL,
  view_json TEXT NOT NULL,
  FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX dataset_traces_object_sha256_idx ON dataset_traces(object_sha256);
CREATE INDEX views_dataset_id_idx ON views(dataset_id);
