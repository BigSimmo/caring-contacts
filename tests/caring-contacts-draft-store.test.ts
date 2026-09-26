// tests/caring-contacts-draft-store.test.ts
import { describe, expect, it } from "vitest";

import { DraftConcurrencyError, DraftStore } from "@/lib/caring-contacts/draft-store";

describe("Task 5 #M6P1QQ: Draft store optimistic locking and concurrent tab protection", () => {
  it("creates a new draft initialized at version 1", () => {
    const store = new DraftStore();
    const draft = store.saveDraft({
      draftId: "draft-1",
      planId: "plan-100",
      contactId: "contact-1",
      authorId: "clinician-1",
      content: "Hello from the care team.",
    });

    expect(draft.draftId).toBe("draft-1");
    expect(draft.version).toBe(1);
    expect(draft.content).toBe("Hello from the care team.");
    expect(draft.createdAt).toBeDefined();
    expect(draft.updatedAt).toBe(draft.createdAt);
  });

  it("updates a draft when expectedVersion matches and increments version", () => {
    const store = new DraftStore();
    store.saveDraft({
      draftId: "draft-1",
      planId: "plan-100",
      authorId: "clinician-1",
      content: "Original draft.",
    });

    const updated = store.saveDraft({
      draftId: "draft-1",
      planId: "plan-100",
      authorId: "clinician-1",
      content: "Updated draft.",
      expectedVersion: 1,
    });

    expect(updated.version).toBe(2);
    expect(updated.content).toBe("Updated draft.");
  });

  it("prevents stale draft overwrite on concurrent tab edit (simulated race condition)", () => {
    const store = new DraftStore();

    // 1. Clinician opens draft in Tab A and Tab B (version 1)
    const initial = store.saveDraft({
      draftId: "draft-shared",
      planId: "plan-100",
      authorId: "clinician-1",
      content: "Initial draft message",
    });
    expect(initial.version).toBe(1);

    // 2. Tab A edits and saves successfully (expectedVersion = 1 -> version becomes 2)
    const tabASave = store.saveDraft({
      draftId: "draft-shared",
      planId: "plan-100",
      authorId: "clinician-1",
      content: "Content edited in Tab A",
      expectedVersion: 1,
    });
    expect(tabASave.version).toBe(2);

    // 3. Tab B (which still holds version 1 in memory) attempts to save
    expect(() => {
      store.saveDraft({
        draftId: "draft-shared",
        planId: "plan-100",
        authorId: "clinician-1",
        content: "Content edited in Tab B (stale)",
        expectedVersion: 1, // Stale! Current is 2
      });
    }).toThrow(DraftConcurrencyError);

    // 4. Verify the error carries conflict details
    try {
      store.saveDraft({
        draftId: "draft-shared",
        planId: "plan-100",
        authorId: "clinician-1",
        content: "Content edited in Tab B (stale)",
        expectedVersion: 1,
      });
    } catch (err) {
      expect(err).toBeInstanceOf(DraftConcurrencyError);
      const concurrencyErr = err as DraftConcurrencyError;
      expect(concurrencyErr.expectedVersion).toBe(1);
      expect(concurrencyErr.currentVersion).toBe(2);
      expect(concurrencyErr.currentDraft?.content).toBe("Content edited in Tab A");
    }

    // 5. Confirm Tab A's content was not overwritten
    const current = store.getDraft("draft-shared");
    expect(current?.version).toBe(2);
    expect(current?.content).toBe("Content edited in Tab A");
  });

  it("throws DraftConcurrencyError if expectedVersion is omitted on update", () => {
    const store = new DraftStore();
    store.saveDraft({
      draftId: "draft-2",
      planId: "plan-200",
      authorId: "clinician-1",
      content: "Initial content",
    });

    // Omitted expectedVersion on an existing draft must throw
    expect(() => {
      store.saveDraft({
        draftId: "draft-2",
        planId: "plan-200",
        authorId: "clinician-1",
        content: "Blind update without version check",
      });
    }).toThrow(DraftConcurrencyError);
  });

  it("enforces version checks on deletion", () => {
    const store = new DraftStore();
    store.saveDraft({
      draftId: "draft-del",
      planId: "plan-300",
      authorId: "clinician-1",
      content: "To be deleted",
    });

    // Stale deletion check
    expect(() => {
      store.deleteDraft("draft-del", 99);
    }).toThrow(DraftConcurrencyError);

    // Correct deletion
    const deleted = store.deleteDraft("draft-del", 1);
    expect(deleted).toBe(true);
    expect(store.getDraft("draft-del")).toBeNull();
  });

  it("lists drafts by planId", () => {
    const store = new DraftStore();
    store.saveDraft({ draftId: "d1", planId: "plan-A", authorId: "c1", content: "Msg 1" });
    store.saveDraft({ draftId: "d2", planId: "plan-A", authorId: "c1", content: "Msg 2" });
    store.saveDraft({ draftId: "d3", planId: "plan-B", authorId: "c1", content: "Msg 3" });

    const draftsA = store.listDraftsForPlan("plan-A");
    expect(draftsA).toHaveLength(2);
    expect(draftsA.map((d) => d.draftId)).toEqual(["d1", "d2"]);
  });

  it("preserves clinician attemptedContent on conflict and prevents resurrecting deleted drafts", () => {
    const store = new DraftStore();
    store.saveDraft({
      draftId: "draft-deleted",
      planId: "plan-A",
      authorId: "c1",
      content: "Original note",
    });

    // Clinician 1 deletes the draft
    store.deleteDraft("draft-deleted", 1);
    expect(store.getDraft("draft-deleted")).toBeNull();

    // Clinician 2 in Tab B attempts to save with expectedVersion 1 and new content
    let caughtError: DraftConcurrencyError | null = null;
    try {
      store.saveDraft({
        draftId: "draft-deleted",
        planId: "plan-A",
        authorId: "c2",
        content: "Care plan vital update in Tab B",
        expectedVersion: 1,
      });
    } catch (err) {
      caughtError = err as DraftConcurrencyError;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError?.draftId).toBe("draft-deleted");
    expect(caughtError?.currentDraft).toBeNull();
    expect(caughtError?.currentVersion).toBeNull();
    // Preserves clinician's attempted edits for copy/recovery
    expect(caughtError?.attemptedContent).toBe("Care plan vital update in Tab B");

    // The deleted draft must NOT be resurrected
    expect(store.getDraft("draft-deleted")).toBeNull();
  });
});
