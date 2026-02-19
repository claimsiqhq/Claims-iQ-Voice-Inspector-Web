export const WORKFLOW_PHASES = [
  "briefing",
  "inspection_setup",
  "interior_rooms",
  "openings",
  "elevations",
  "roof",
  "photos_damage",
  "scope_build",
  "review",
  "export",
] as const;

export type WorkflowPhase = (typeof WORKFLOW_PHASES)[number];

export const WORKFLOW_STEPS: Record<WorkflowPhase, string[]> = {
  briefing: ["briefing.review"],
  inspection_setup: ["session.bootstrap", "structure.select"],
  interior_rooms: ["interior.capture_rooms"],
  openings: ["openings.capture"],
  elevations: ["elevations.capture"],
  roof: ["roof.capture"],
  photos_damage: ["photos.map_damage"],
  scope_build: ["scope.assemble"],
  review: ["review.resolve_warnings"],
  export: ["export.validate", "export.generate"],
};

const GLOBAL_TOOLS = ["get_workflow_state", "set_phase", "set_context", "trigger_photo_capture", "analyze_photo", "get_inspection_state"];

export const PHASE_ALLOWED_TOOLS: Record<WorkflowPhase, string[]> = {
  briefing: [...GLOBAL_TOOLS],
  inspection_setup: [...GLOBAL_TOOLS, "create_structure"],
  interior_rooms: [...GLOBAL_TOOLS, "create_room", "create_sub_area", "update_room"],
  openings: [...GLOBAL_TOOLS, "add_opening", "update_opening", "delete_opening"],
  elevations: [...GLOBAL_TOOLS, "create_room", "add_opening", "add_sketch_annotation"],
  roof: [...GLOBAL_TOOLS, "create_room", "add_damage", "add_sketch_annotation", "log_test_square"],
  photos_damage: [...GLOBAL_TOOLS, "add_damage", "confirm_damage"],
  scope_build: [...GLOBAL_TOOLS, "add_line_item", "update_line_item", "validate_scope"],
  review: [...GLOBAL_TOOLS, "validate_scope", "run_workflow_gates"],
  export: [...GLOBAL_TOOLS, "run_workflow_gates", "export_esx"],
};
