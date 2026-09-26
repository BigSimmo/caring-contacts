// src/lib/caring-contacts/plan-store.ts
//
// Plan store adaptation and createPlan enforcement.
// Enforces that patient name is non-blank (name.trim().length > 0),
// throwing a validation error if blank.

import { type PlanAssurance } from "./assurances";
import { systemClock, type Clock } from "./clock";
import {
  idempotencyKey,
  pathwayVersionId,
  patientId,
  planId,
  referralId,
  type PathwayVersionId,
  type PatientId,
  type PlanId,
  type ReferralId,
} from "./ids";
import { createInMemoryRepository } from "./in-memory-repository";
import { ValidationError } from "./episode";
import type { SendingPreference, TransitionResult } from "./model";
import type { Actor } from "./permissions";
import type {
  CaringContactRepository,
  CreatePlanInput,
  EpisodePatientDetail,
  PlanRecord,
  WriteContext,
} from "./repository";

export interface PlanStoreInput {
  patientName: string;
  planId?: PlanId | string;
  referralId?: ReferralId | string;
  patientId?: PatientId | string;
  pathwayVersionId?: PathwayVersionId | string;
  dischargeAt?: Date;
  sendingPreference?: SendingPreference;
  firstContactDate?: string;
  firstContactReason?: string;
  patientMobileNumber?: string;
  patientIdentifiers?: string[];
  culturalIdentity?: string | null;
  preferredName?: string | null;
  patientDetail?: Partial<EpisodePatientDetail>;
  assurances?: readonly PlanAssurance[];
  idempotencyKey?: string;
}

export type PlanCreationInput = CreatePlanInput | PlanStoreInput;

export type AdaptedPlanRecord = PlanRecord;

export interface PlanStore {
  readonly repository: CaringContactRepository;
  createPlan(input: PlanCreationInput, context: WriteContext): Promise<TransitionResult<AdaptedPlanRecord>>;
  getPlan(id: PlanId, context: { actor: Actor }): Promise<PlanRecord | null>;
  listPlans(context: { actor: Actor }): Promise<readonly PlanRecord[]>;
}

export function validatePatientName(name: unknown): string {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new ValidationError(
      "Validation error: patient name must not be blank: Patient name cannot be blank or whitespace",
    );
  }
  return name.trim();
}

export function adaptPlanInput(input: PlanCreationInput): CreatePlanInput {
  const rawName =
    (typeof (input as { patientName?: string }).patientName === "string"
      ? (input as { patientName?: string }).patientName
      : undefined) ??
    (typeof (input as { patientDetail?: { patientName?: string } }).patientDetail?.patientName === "string"
      ? (input as { patientDetail?: { patientName?: string } }).patientDetail?.patientName
      : undefined);

  const validName = validatePatientName(rawName);

  const planInput = input as Partial<CreatePlanInput> & Partial<PlanStoreInput>;
  if (!Array.isArray(planInput.assurances)) {
    throw new Error("Validation error: explicit plan assurances are required");
  }

  const defaultId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const pId = planInput.planId ? planId(String(planInput.planId)) : planId(`PLAN-${defaultId}`);
  const rId = planInput.referralId ? referralId(String(planInput.referralId)) : referralId(`REF-${defaultId}`);
  const ptId = planInput.patientId ? patientId(String(planInput.patientId)) : patientId(`PAT-${defaultId}`);
  const pvId = planInput.pathwayVersionId
    ? pathwayVersionId(String(planInput.pathwayVersionId))
    : pathwayVersionId(`PV-${defaultId}`);

  const detail: EpisodePatientDetail = {
    patientName: validName,
    patientMobileNumber:
      planInput.patientDetail?.patientMobileNumber ?? planInput.patientMobileNumber ?? "+61 491 570 156",
    patientIdentifiers: planInput.patientDetail?.patientIdentifiers ?? planInput.patientIdentifiers ?? ["UR-001"],
    culturalIdentity: planInput.patientDetail?.culturalIdentity ?? planInput.culturalIdentity ?? null,
    preferredName:
      planInput.patientDetail?.preferredName ?? planInput.preferredName ?? validName.split(" ")[0] ?? "Patient",
  };

  return {
    planId: pId,
    referralId: rId,
    patientId: ptId,
    pathwayVersionId: pvId,
    dischargeAt: planInput.dischargeAt ?? new Date(),
    sendingPreference: planInput.sendingPreference ?? "morning",
    firstContactDate: planInput.firstContactDate,
    firstContactReason: planInput.firstContactReason,
    patientDetail: detail,
    assurances: planInput.assurances,
  };
}

export function defaultWriteContext(actorParam: Actor): WriteContext {
  if (!actorParam?.id || !actorParam.teamId || !Array.isArray(actorParam.roles)) {
    throw new Error("Validation error: authenticated actor is required");
  }
  return {
    actor: actorParam,
    idempotencyKey: idempotencyKey(`key-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
  };
}

export function adaptPlanStore(repository: CaringContactRepository): PlanStore {
  return {
    repository,
    async createPlan(input: PlanCreationInput, context: WriteContext): Promise<TransitionResult<AdaptedPlanRecord>> {
      const fullInput = adaptPlanInput(input);
      if (!context?.actor?.id || !context.actor.teamId || !context.idempotencyKey) {
        throw new Error("Validation error: authenticated write context is required");
      }
      return repository.createPlan(fullInput, context);
    },
    async getPlan(id: PlanId, context: { actor: Actor }): Promise<PlanRecord | null> {
      return repository.getPlan(id, context);
    },
    async listPlans(context: { actor: Actor }): Promise<readonly PlanRecord[]> {
      return repository.listPlans(context);
    },
  };
}

export function createPlanStore(repository?: CaringContactRepository, clock?: Clock): PlanStore {
  const repo = repository ?? createInMemoryRepository(clock ?? systemClock());
  return adaptPlanStore(repo);
}

let defaultStoreInstance: PlanStore | null = null;
function getOrCreateDefaultStore(): PlanStore {
  if (!defaultStoreInstance) {
    defaultStoreInstance = createPlanStore();
  }
  return defaultStoreInstance;
}

export async function createPlan(
  input: PlanCreationInput,
  context: WriteContext,
  repository?: CaringContactRepository,
): Promise<TransitionResult<AdaptedPlanRecord>> {
  const rawName =
    (typeof (input as { patientName?: string }).patientName === "string"
      ? (input as { patientName?: string }).patientName
      : undefined) ??
    (typeof (input as { patientDetail?: { patientName?: string } }).patientDetail?.patientName === "string"
      ? (input as { patientDetail?: { patientName?: string } }).patientDetail?.patientName
      : undefined);

  validatePatientName(rawName);

  const store = repository ? adaptPlanStore(repository) : getOrCreateDefaultStore();
  return store.createPlan(input, context);
}
