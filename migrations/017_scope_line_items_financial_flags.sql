-- Migration 017: Add financial flags to scope_line_items
-- op_eligible_default and is_code_upgrade (from PROMPT-14 / PROMPT-16)

ALTER TABLE scope_line_items ADD COLUMN IF NOT EXISTS op_eligible_default BOOLEAN DEFAULT TRUE;
ALTER TABLE scope_line_items ADD COLUMN IF NOT EXISTS is_code_upgrade BOOLEAN DEFAULT FALSE;
