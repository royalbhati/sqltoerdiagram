PRAGMA foreign_keys=ON;
BEGIN TRANSACTION;
CREATE TABLE IF NOT EXISTS "artists" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL UNIQUE
);
CREATE TABLE albums (
  id INTEGER PRIMARY KEY,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  released DATE
);
CREATE TABLE tracks (
  id INTEGER PRIMARY KEY,
  album_id INTEGER,
  title TEXT,
  seconds REAL CHECK (seconds > 0),
  FOREIGN KEY (album_id) REFERENCES albums (id)
) WITHOUT ROWID;
CREATE INDEX idx_tracks_album ON tracks(album_id);
COMMIT;
