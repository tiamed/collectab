-- Historical CRDT snapshots were write-only (never loaded). Clear bloat; app no longer persists them.
TRUNCATE TABLE crdt_snapshots;
