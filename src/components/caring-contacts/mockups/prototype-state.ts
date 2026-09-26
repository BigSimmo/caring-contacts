export type CaringContactScenario =
  | "normal"
  | "loading"
  | "empty"
  | "offline"
  | "expired-session"
  | "permission-unavailable"
  | "recoverable-error"
  | "version-conflict";

export type PrototypeOutcome = {
  kind: "success" | "blocked" | "info";
  message: string;
};

export type CaringContactPrototypeState = {
  scenario: CaringContactScenario;
  persistence: "memory-only";
  activeTeamId: "SYN-TEAM-NORTH" | "SYN-TEAM-CENTRAL";
  connectivity: { online: boolean };
  permission: { available: boolean };
  authentication: { authenticated: boolean };
  versionConflict: { active: boolean };
  patient: {
    id: "SYN-PATIENT-001";
    displayName: "Rowan Sample";
  };
  plan: {
    id: "SYN-PLAN-001";
    status: "Draft" | "Active" | "Paused" | "Withdrawn";
    coordinatorId: "SYN-TEAM-001" | "SYN-TEAM-002";
  };
  audit: Array<{ id: string; event: string; at: string }>;
  lastOutcome: PrototypeOutcome | null;
};

export type CaringContactPrototypeAction =
  | { type: "activate-plan" }
  | { type: "pause-plan" }
  | { type: "resume-plan" }
  | { type: "withdraw-plan" }
  | { type: "reassign-plan"; coordinatorId: CaringContactPrototypeState["plan"]["coordinatorId"] }
  | { type: "set-connectivity"; online: boolean }
  | { type: "set-permission"; available: boolean }
  | { type: "set-authentication"; authenticated: boolean }
  | { type: "set-version-conflict"; active: boolean }
  | { type: "set-team"; teamId: CaringContactPrototypeState["activeTeamId"] }
  | { type: "apply-scenario"; scenario: CaringContactScenario }
  | { type: "set-outcome"; outcome: PrototypeOutcome | null }
  | { type: "reset" };

const FIXTURE_AUDIT = [
  {
    id: "SYN-AUDIT-001",
    event: "Referral accepted by Example Transition Unit",
    at: "2026-08-15T09:35:00+08:00",
  },
] as const;

// The scenario is a view of the four blocking flags, not an independent field.
// Setting it from one flag alone let "normal" appear while another blocker was
// still engaged, so the scenario notice contradicted the mutation guard.
function scenarioForFlags(state: CaringContactPrototypeState): CaringContactScenario {
  if (!state.connectivity.online) return "offline";
  if (!state.permission.available) return "permission-unavailable";
  if (!state.authentication.authenticated) return "expired-session";
  if (state.versionConflict.active) return "version-conflict";
  return "normal";
}

function withDerivedScenario(state: CaringContactPrototypeState): CaringContactPrototypeState {
  return { ...state, scenario: scenarioForFlags(state) };
}

function scenarioFlags(scenario: CaringContactScenario) {
  return {
    online: scenario !== "offline",
    permissionAvailable: scenario !== "permission-unavailable",
    authenticated: scenario !== "expired-session",
    versionConflict: scenario === "version-conflict",
  };
}

export function createInitialPrototypeState(scenario: CaringContactScenario = "normal"): CaringContactPrototypeState {
  const flags = scenarioFlags(scenario);
  return {
    scenario,
    persistence: "memory-only",
    activeTeamId: "SYN-TEAM-NORTH",
    connectivity: { online: flags.online },
    permission: { available: flags.permissionAvailable },
    authentication: { authenticated: flags.authenticated },
    versionConflict: { active: flags.versionConflict },
    patient: { id: "SYN-PATIENT-001", displayName: "Rowan Sample" },
    plan: { id: "SYN-PLAN-001", status: "Active", coordinatorId: "SYN-TEAM-001" },
    audit: FIXTURE_AUDIT.map((event) => ({ ...event })),
    lastOutcome: null,
  };
}

export function getPrototypeMutationBlockReason(state: CaringContactPrototypeState): string | null {
  if (!state.connectivity.online) return "You are offline. No synthetic plan change was made.";
  if (!state.permission.available) return "Permission is unavailable. No synthetic plan change was made.";
  if (!state.authentication.authenticated) return "Your session has expired. No synthetic plan change was made.";
  if (state.versionConflict.active) return "A newer draft exists. No synthetic plan change was made.";
  return null;
}

function applyPlanMutation(
  state: CaringContactPrototypeState,
  mutation: (plan: CaringContactPrototypeState["plan"]) => CaringContactPrototypeState["plan"],
  event: string,
): CaringContactPrototypeState {
  const blocked = getPrototypeMutationBlockReason(state);
  if (blocked) return { ...state, lastOutcome: { kind: "blocked", message: blocked } };
  return {
    ...state,
    plan: mutation(state.plan),
    audit: [
      ...state.audit,
      {
        id: `SYN-AUDIT-${String(state.audit.length + 1).padStart(3, "0")}`,
        event,
        at: "2026-08-15T10:01:00+08:00",
      },
    ],
    lastOutcome: {
      kind: "success",
      message: `${event}. This changed only the in-memory synthetic prototype; no message was sent.`,
    },
  };
}

export function prototypeReducer(
  state: CaringContactPrototypeState,
  action: CaringContactPrototypeAction,
): CaringContactPrototypeState {
  switch (action.type) {
    case "activate-plan":
      return applyPlanMutation(
        state,
        (plan) => ({ ...plan, status: "Active" }),
        "Plan activated in synthetic prototype",
      );
    case "pause-plan":
      return applyPlanMutation(state, (plan) => ({ ...plan, status: "Paused" }), "Plan paused in synthetic prototype");
    case "resume-plan":
      return applyPlanMutation(state, (plan) => ({ ...plan, status: "Active" }), "Plan resumed in synthetic prototype");
    case "withdraw-plan":
      return applyPlanMutation(
        state,
        (plan) => ({ ...plan, status: "Withdrawn" }),
        "Plan withdrawn in synthetic prototype",
      );
    case "reassign-plan":
      return applyPlanMutation(
        state,
        (plan) => ({ ...plan, coordinatorId: action.coordinatorId }),
        "Plan reassigned in synthetic prototype",
      );
    case "set-connectivity":
      return withDerivedScenario({ ...state, connectivity: { online: action.online } });
    case "set-permission":
      return withDerivedScenario({ ...state, permission: { available: action.available } });
    case "set-authentication":
      return withDerivedScenario({ ...state, authentication: { authenticated: action.authenticated } });
    case "set-version-conflict":
      return withDerivedScenario({ ...state, versionConflict: { active: action.active } });
    case "set-team": {
      const blocked = getPrototypeMutationBlockReason(state);
      if (blocked) return { ...state, lastOutcome: { kind: "blocked", message: blocked } };
      return {
        ...state,
        activeTeamId: action.teamId,
        lastOutcome: {
          kind: "success",
          // Says only what happens. The prototype's fixture is a single
          // synthetic patient (`SYN-PATIENT-001`, fixed by type), so there is no
          // second team's patient context to clear and claiming otherwise
          // described an isolation behaviour the prototype does not implement.
          message:
            "Active synthetic team changed. The one synthetic patient record is unchanged. No external action occurred.",
        },
      };
    }
    case "apply-scenario": {
      const flags = scenarioFlags(action.scenario);
      return {
        ...state,
        scenario: action.scenario,
        connectivity: { online: flags.online },
        permission: { available: flags.permissionAvailable },
        authentication: { authenticated: flags.authenticated },
        versionConflict: { active: flags.versionConflict },
        lastOutcome: null,
      };
    }
    case "set-outcome":
      return { ...state, lastOutcome: action.outcome };
    case "reset":
      return createInitialPrototypeState();
  }
}
