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

export const PHASE_ALLOWED_TOOLS: Record<WorkflowPhase, string[]> = {
  briefing: ["get_workflow_state", "set_phase"],
  inspection_setup: ["get_workflow_state", "set_phase", "set_context", "create_structure", "get_inspection_state"],
  interior_rooms: ["get_workflow_state", "set_phase", "set_context", "create_room", "create_sub_area", "update_room", "get_inspection_state"],
  openings: ["get_workflow_state", "set_phase", "set_context", "add_opening", "update_opening", "delete_opening", "get_inspection_state"],
  elevations: ["get_workflow_state", "set_phase", "set_context", "create_room", "add_opening", "add_sketch_annotation"],
  roof: ["get_workflow_state", "set_phase", "set_context", "create_room", "add_damage", "add_sketch_annotation", "log_test_square"],
  photos_damage: ["get_workflow_state", "set_phase", "set_context", "trigger_photo_capture", "add_damage", "confirm_damage", "analyze_photo"],
  scope_build: ["get_workflow_state", "set_phase", "set_context", "add_line_item", "update_line_item", "validate_scope"],
  review: ["get_workflow_state", "set_phase", "set_context", "validate_scope", "run_workflow_gates"],
  export: ["get_workflow_state", "set_phase", "run_workflow_gates", "export_esx"],
};
