// Compatibility surface: server operations go through the server adapter.
export { listProjectSummaries, getProjectDetail, validateProjectPlacement, deleteProjectSafely, deletePhaseSafely } from "@/server/projects";
export { parseProjectStatus, ProjectRuleError } from "@/modules/projects/domain/project";
