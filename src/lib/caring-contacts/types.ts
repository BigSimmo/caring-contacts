// src/lib/caring-contacts/types.ts
//
// Lightweight case-note types for safety incident responder notes (#JZ8B36).

export type IncidentCaseNote = {
  id: string;
  episodeId: string;
  note: string;
  authorId: string;
  createdAt: string;
  stopId?: string;
  reason?: string;
  restartedAt?: string | null;
  stoppedBy?: string;
};

export type IncidentNoteArchiveResult =
  | {
      ok: true;
      episodeId: string;
      archived: true;
      reason: string;
      archivedAt: string;
      notesArchived?: number;
    }
  | {
      ok: false;
      episodeId: string;
      archived: false;
      reason: string;
      archivedAt?: never;
      error?: string;
    };
