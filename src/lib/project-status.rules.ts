export const PROJECT_STATUS_ERROR_DETAILS = {
  UNAUTHORIZED: { status: 401, message: "Authentication is required." },
  PROJECT_NOT_FOUND: { status: 404, message: "Project not found." },
  PROJECT_ADMIN_REQUIRED: {
    status: 403,
    message: "Only a project admin can complete this project.",
  },
  PROJECT_ADMIN_APPROVER_REQUIRED: {
    status: 409,
    message: "Assign a project admin before requesting final handover approval.",
  },
  COMPANY_ADMIN_REQUIRED: {
    status: 403,
    message: "Only a company admin can reopen a completed project.",
  },
  PROJECT_HANDOVER_REQUIRED: {
    status: 409,
    message: "The project must be in the handover phase before completion.",
  },
  PROJECT_HANDOVER_GATE_REQUIRED: {
    status: 409,
    message: "Approve the handover gate before completing the project.",
  },
  PROJECT_NOT_COMPLETED: {
    status: 409,
    message: "Only a completed project can be reopened.",
  },
  PROJECT_REOPEN_REASON_REQUIRED: {
    status: 400,
    message: "A reason is required to reopen a completed project.",
  },
  PROJECT_STATUS_TRANSITION_REQUIRED: {
    status: 409,
    message: "Use the governed project completion or reopen action.",
  },
  HANDOVER_GATE_DECISION_REQUIRED: {
    status: 409,
    message: "Use the governed handover decision action.",
  },
  COMMENT_REQUIRED_ON_REJECT: {
    status: 400,
    message: "A comment is required when rejecting final handover.",
  },
  APPROVAL_NOT_FOUND: { status: 404, message: "Approval not found." },
  APPROVAL_INSTANCE_NOT_FOUND: { status: 404, message: "Approval instance not found." },
  GATE_NOT_FOUND: { status: 404, message: "Gate not found." },
  NOT_YOUR_APPROVAL: { status: 403, message: "This approval is assigned to another user." },
  APPROVAL_ALREADY_DECIDED: { status: 409, message: "This approval was already decided." },
  APPROVAL_INSTANCE_ALREADY_DECIDED: {
    status: 409,
    message: "This approval workflow was already decided.",
  },
  HANDOVER_GATE_REQUIRED: { status: 409, message: "This action requires the handover gate." },
  GATE_NOT_IN_REVIEW: { status: 409, message: "The handover gate is not in review." },
  INVALID_HANDOVER_DECISION: { status: 400, message: "Invalid handover decision." },
} as const;

export const PROJECT_COMPLETION_ROLE = "project_admin" as const;

export type ProjectLifecycleActionInput = {
  roles: readonly string[];
  projectStatus: string;
  projectPhase: string;
  handoverGateStatus: string | null | undefined;
};

export type ProjectLifecycleActionState = {
  canComplete: boolean;
  canReopen: boolean;
  completionBlocker:
    | "already_completed"
    | "project_admin_required"
    | "handover_phase_required"
    | "handover_gate_approval_required"
    | null;
};

export function getProjectLifecycleActionState({
  roles,
  projectStatus,
  projectPhase,
  handoverGateStatus,
}: ProjectLifecycleActionInput): ProjectLifecycleActionState {
  const isCompleted = projectStatus === "completed";
  const isProjectAdmin = roles.includes(PROJECT_COMPLETION_ROLE);
  const canReopen = isCompleted && roles.includes("company_admin");

  let completionBlocker: ProjectLifecycleActionState["completionBlocker"] = null;
  if (isCompleted) completionBlocker = "already_completed";
  else if (!isProjectAdmin) completionBlocker = "project_admin_required";
  else if (projectPhase !== "handover") completionBlocker = "handover_phase_required";
  else if (handoverGateStatus !== "approved") {
    completionBlocker = "handover_gate_approval_required";
  }

  return {
    canComplete: completionBlocker === null,
    canReopen,
    completionBlocker,
  };
}

export type ProjectStatusErrorCode = keyof typeof PROJECT_STATUS_ERROR_DETAILS;

export type ProjectStatusErrorDetail = {
  code: ProjectStatusErrorCode;
  status: number;
  message: string;
};

export function projectStatusErrorDetail(
  error: { code?: string; message?: string } | null | undefined,
): ProjectStatusErrorDetail | null {
  const message = error?.message ?? "";
  for (const code of Object.keys(PROJECT_STATUS_ERROR_DETAILS) as ProjectStatusErrorCode[]) {
    if (message.includes(code)) {
      const detail = PROJECT_STATUS_ERROR_DETAILS[code];
      return { code, status: detail.status, message: detail.message };
    }
  }
  return null;
}
