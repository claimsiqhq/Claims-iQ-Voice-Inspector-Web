-- Migration 018: Add per-item tax configuration to scope_line_items
-- Purpose: Allow specific items to have non-standard tax treatment (PROMPT-27)
-- tax_rate: override tax rate as percentage (null = use settlement rules default)

ALTER TABLE scope_line_items ADD COLUMN IF NOT EXISTS tax_rate REAL;
