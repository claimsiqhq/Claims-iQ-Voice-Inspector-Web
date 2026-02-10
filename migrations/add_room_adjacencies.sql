CREATE TABLE IF NOT EXISTS room_adjacencies (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES inspection_sessions(id) ON DELETE CASCADE,
  room_id_a INTEGER NOT NULL REFERENCES inspection_rooms(id) ON DELETE CASCADE,
  room_id_b INTEGER NOT NULL REFERENCES inspection_rooms(id) ON DELETE CASCADE,
  wall_direction_a VARCHAR(20),
  wall_direction_b VARCHAR(20),
  shared_wall_length_ft REAL,
  opening_id INTEGER REFERENCES room_openings(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for fast lookup by room
CREATE INDEX IF NOT EXISTS idx_room_adjacencies_room_a ON room_adjacencies(room_id_a);
CREATE INDEX IF NOT EXISTS idx_room_adjacencies_room_b ON room_adjacencies(room_id_b);
CREATE INDEX IF NOT EXISTS idx_room_adjacencies_session ON room_adjacencies(session_id);
