-- Migration 016: Scope Engine Foundation
-- Creates scope_trades, scope_items, scope_summary tables
-- Enhances line_items with trade_code and coverage_type
-- Seeds 16 trade categories with O&P eligibility

-- ── scope_trades ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scope_trades (
  id SERIAL PRIMARY KEY,
  code VARCHAR(10) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  xact_category_prefix VARCHAR(10),
  op_eligible BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE
);

-- Seed 16 trades matching Xactimate trade categories
INSERT INTO scope_trades (code, name, xact_category_prefix, op_eligible, sort_order) VALUES
  ('MIT', 'Mitigation / Water Extraction', 'WTR', true, 1),
  ('DEM', 'Demolition', 'DEM', true, 2),
  ('DRY', 'Drywall', 'DRY', true, 3),
  ('PNT', 'Painting', 'PNT', true, 4),
  ('FLR', 'Flooring', 'FLR', true, 5),
  ('INS', 'Insulation', 'INS', true, 6),
  ('CAR', 'Carpentry / Framing', 'FRM', true, 7),
  ('CAB', 'Cabinetry', 'CAB', true, 8),
  ('CTR', 'Countertops', 'CTR', true, 9),
  ('RFG', 'Roofing', 'RFG', true, 10),
  ('WIN', 'Windows', 'WIN', true, 11),
  ('EXT', 'Exterior / Siding', 'SDG', true, 12),
  ('ELE', 'Electrical', 'ELE', true, 13),
  ('PLM', 'Plumbing', 'PLM', true, 14),
  ('HVAC', 'HVAC', 'HVA', true, 15),
  ('GEN', 'General / Cleanup', 'GEN', false, 16)
ON CONFLICT (code) DO NOTHING;

-- ── Enhance scope_line_items ─────────────────────────────────
ALTER TABLE scope_line_items ADD COLUMN IF NOT EXISTS coverage_type VARCHAR(1) DEFAULT 'A';
ALTER TABLE scope_line_items ADD COLUMN IF NOT EXISTS xact_category_code VARCHAR(10);
ALTER TABLE scope_line_items ADD COLUMN IF NOT EXISTS xact_selector VARCHAR(20);
ALTER TABLE scope_line_items ADD COLUMN IF NOT EXISTS notes TEXT;

-- ── scope_items ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scope_items (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES inspection_sessions(id) ON DELETE CASCADE,
  room_id INTEGER REFERENCES inspection_rooms(id) ON DELETE SET NULL,
  damage_id INTEGER REFERENCES damage_observations(id) ON DELETE SET NULL,
  catalog_code VARCHAR(30) REFERENCES scope_line_items(code),
  description TEXT NOT NULL,
  trade_code VARCHAR(10) NOT NULL,
  quantity REAL NOT NULL,
  unit VARCHAR(10) NOT NULL,
  quantity_formula VARCHAR(50),
  provenance VARCHAR(30) NOT NULL DEFAULT 'voice_command',
  coverage_type VARCHAR(1) DEFAULT 'A',
  activity_type VARCHAR(20) DEFAULT 'replace',
  waste_factor REAL,
  status VARCHAR(20) DEFAULT 'active',
  parent_scope_item_id INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scope_items_session ON scope_items(session_id);
CREATE INDEX IF NOT EXISTS idx_scope_items_room ON scope_items(room_id);
CREATE INDEX IF NOT EXISTS idx_scope_items_damage ON scope_items(damage_id);
CREATE INDEX IF NOT EXISTS idx_scope_items_trade ON scope_items(trade_code);

-- ── scope_summary ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scope_summary (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES inspection_sessions(id) ON DELETE CASCADE,
  trade_code VARCHAR(10) NOT NULL,
  trade_name VARCHAR(100),
  item_count INTEGER DEFAULT 0,
  quantities_by_unit JSONB,
  total_material REAL DEFAULT 0,
  total_labor REAL DEFAULT 0,
  total_equipment REAL DEFAULT 0,
  total_tax REAL DEFAULT 0,
  total_rcv REAL DEFAULT 0,
  total_depreciation REAL DEFAULT 0,
  total_acv REAL DEFAULT 0,
  op_eligible BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scope_summary_session_trade
  ON scope_summary(session_id, trade_code);

-- ── Enhance line_items ───────────────────────────────────────
ALTER TABLE line_items ADD COLUMN IF NOT EXISTS trade_code VARCHAR(10);
ALTER TABLE line_items ADD COLUMN IF NOT EXISTS coverage_type VARCHAR(1) DEFAULT 'A';

-- ── Updated_at trigger for scope tables ──────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS scope_items_updated_at ON scope_items;
CREATE TRIGGER scope_items_updated_at
  BEFORE UPDATE ON scope_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS scope_summary_updated_at ON scope_summary;
CREATE TRIGGER scope_summary_updated_at
  BEFORE UPDATE ON scope_summary
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
