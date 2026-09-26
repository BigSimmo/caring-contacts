// src/lib/caring-contacts/draft-store.ts
//
// Draft message store with optimistic concurrency locking.
//
// Bug fix #M6P1QQ:
// Prevents stale draft message overwrites when editing concurrently in multiple tabs.
// Enforces version checks on updates, raising DraftConcurrencyError to alert the
// clinician if a draft was modified elsewhere.

export type DraftMessage = {
  draftId: string;
  planId: string;
  contactId?: string;
  authorId: string;
  content: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Generic over the stored draft's own shape, defaulting to `DraftMessage` so every existing caller
 * in this file keeps resolving without naming the parameter.
 *
 * #M6P1QQ follow-up: this error, and the version check that throws it, are the optimistic-locking
 * PATTERN this module exists to provide -- not a `DraftMessage`-only mechanism. The real clinical
 * draft path this was meant to guard (`writePlanDraft` in
 * `src/components/caring-contacts/workspace/plan-wizard/plan-draft.ts`) stores a `PlanDraft`, which
 * shares no fields with `DraftMessage` beyond a version number, so a caller there needs the SAME
 * class with a DIFFERENT `currentDraft` shape rather than a hand-rolled duplicate of this one.
 */
export class DraftConcurrencyError<TDraft = DraftMessage> extends Error {
  readonly code = "stale_draft_conflict" as const;
  readonly draftId: string;
  readonly expectedVersion: number;
  readonly currentVersion: number | null;
  readonly currentDraft: TDraft | null;
  /** Preserves the clinician's attempted edit text during conflicts to prevent data loss. */
  readonly attemptedContent?: string;

  constructor(
    draftId: string,
    expectedVersion: number,
    currentVersion: number | null,
    currentDraft: TDraft | null,
    attemptedContent?: string,
  ) {
    super(
      currentDraft === null
        ? `Draft "${draftId}" was deleted or not found in another session (expected version ${expectedVersion}). Reload to view the latest draft state.`
        : `Draft "${draftId}" was modified in another tab or session (expected version ${expectedVersion}, but found version ${currentVersion}). Reload to view the latest draft before saving.`,
    );
    this.name = "DraftConcurrencyError";
    this.draftId = draftId;
    this.expectedVersion = expectedVersion;
    this.currentVersion = currentVersion;
    this.currentDraft = currentDraft;
    this.attemptedContent = attemptedContent;
  }
}

export type SaveDraftParams = {
  /** If updating an existing draft, draftId is required. If creating, draftId is optional. */
  draftId?: string;
  planId: string;
  contactId?: string;
  authorId: string;
  content: string;
  /**
   * Expected version for optimistic locking.
   * Required when updating an existing draft. If omitted or mismatched on update,
   * DraftConcurrencyError is thrown.
   */
  expectedVersion?: number;
  now?: Date;
};

export class DraftStore {
  private drafts = new Map<string, DraftMessage>();

  /**
   * Saves a draft message with optimistic locking.
   *
   * If updating an existing draft:
   *   Requires `expectedVersion === currentDraft.version`.
   *   Increments version and updates `updatedAt`.
   *   Throws `DraftConcurrencyError` on mismatch.
   *
   * If updating a draft that was deleted or not found:
   *   Throws `DraftConcurrencyError` rather than silently resurrecting it.
   *
   * If creating a new draft:
   *   Initializes version to 1.
   */
  saveDraft(params: SaveDraftParams): DraftMessage {
    const now = params.now ?? new Date();
    const timestamp = now.toISOString();

    if (params.draftId) {
      if (this.drafts.has(params.draftId)) {
        const existing = this.drafts.get(params.draftId)!;

        if (params.expectedVersion === undefined || params.expectedVersion !== existing.version) {
          throw new DraftConcurrencyError(
            existing.draftId,
            params.expectedVersion ?? -1,
            existing.version,
            { ...existing },
            params.content,
          );
        }

        const updated: DraftMessage = {
          ...existing,
          contactId: params.contactId ?? existing.contactId,
          authorId: params.authorId,
          content: params.content,
          version: existing.version + 1,
          updatedAt: timestamp,
        };

        this.drafts.set(updated.draftId, updated);
        return { ...updated };
      }

      // If expectedVersion was specified for a draftId that does not exist,
      // it means the draft was deleted concurrently. Prevent resurrection.
      if (params.expectedVersion !== undefined) {
        throw new DraftConcurrencyError(params.draftId, params.expectedVersion, null, null, params.content);
      }
    }

    const draftId = params.draftId ?? `draft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const newDraft: DraftMessage = {
      draftId,
      planId: params.planId,
      contactId: params.contactId,
      authorId: params.authorId,
      content: params.content,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.drafts.set(draftId, newDraft);
    return { ...newDraft };
  }

  getDraft(draftId: string): DraftMessage | null {
    const draft = this.drafts.get(draftId);
    return draft ? { ...draft } : null;
  }

  deleteDraft(draftId: string, expectedVersion?: number): boolean {
    const existing = this.drafts.get(draftId);
    if (!existing) return false;

    if (expectedVersion !== undefined && expectedVersion !== existing.version) {
      throw new DraftConcurrencyError(draftId, expectedVersion, existing.version, { ...existing });
    }

    return this.drafts.delete(draftId);
  }

  listDraftsForPlan(planId: string): DraftMessage[] {
    const results: DraftMessage[] = [];
    for (const draft of this.drafts.values()) {
      if (draft.planId === planId) {
        results.push({ ...draft });
      }
    }
    return results;
  }

  clear(): void {
    this.drafts.clear();
  }
}

/** Global default draft store singleton. */
export const defaultDraftStore = new DraftStore();
