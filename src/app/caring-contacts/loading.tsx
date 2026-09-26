import { SyntheticMarker } from "@/components/caring-contacts/workspace/synthetic-marker";
import { Skeleton } from "@/components/primitive-recipes/feedback";

/**
 * The workspace's route skeleton, shaped like the workspace.
 *
 * It used to be a single full-width column of `animate-pulse` blocks with no rail, no header band
 * and no dock, so every navigation at 768px and up painted a one-column page and then snapped into
 * a 256px rail plus a content column — the largest layout shift anywhere in this workspace, on
 * every route change. The silhouette below mirrors `CaringContactsShell`'s own structure at each
 * width, so the skeleton and the screen that replaces it occupy the same boxes.
 *
 * `Skeleton` is the app's shared placeholder (shimmer, and `motion-safe:` so reduced-motion gets a
 * static block rather than a blank one). The hand-rolled `animate-pulse` blocks this replaces were
 * the only place in the workspace that painted a loading state in a different idiom from the rest
 * of PsychSift. `primitive-recipes/feedback` carries no `"use client"`, so this adds no client
 * chunk and Ruling 13 is untouched.
 *
 * DELIBERATELY ABSENT, and this is load-bearing rather than an oversight: none of
 * `data-testid="caring-contacts-rail"`, `data-testid="caring-contacts-phone-dock"`,
 * `data-testid="caring-contacts-primary-control"` or `data-workspace-width-state` appears below.
 * React streams this segment into a hidden holder before moving it, so the skeleton and the real
 * shell can both be in the document for a moment; `openWorkspace` in
 * `tests/ui-caring-contacts-workspace.spec.ts` asserts exactly one rail and exactly one displayed
 * width-state marker precisely because of that. Duplicating either hook here would redden most of
 * that suite for a reason that has nothing to do with the workspace being wrong.
 *
 * The synthetic marker is carried here too: a screenshot of a loading state should still say that
 * everything behind it is invented.
 */
export default function LoadingCaringContactsWorkspace() {
  return (
    <div aria-busy="true" className="min-h-dvh bg-[color:var(--background)] text-[color:var(--text)] md:flex">
      <p className="sr-only">Loading the Caring Contacts workspace</p>

      {/* The rail's box, at the widths the rail occupies one. */}
      <div
        aria-hidden="true"
        className="sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-[color:var(--border)] bg-[color:var(--surface-chrome)] md:flex md:w-20 lg:w-64"
      >
        <div className="flex min-h-[var(--header-h)] items-center gap-3 border-b border-[color:var(--border)] px-4 lg:px-5">
          <Skeleton className="size-9 shrink-0 rounded-md" />
          <Skeleton className="hidden h-4 w-32 lg:block" />
        </div>
        <div className="mt-3 flex flex-col gap-1 px-3">
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} className="h-tap w-full rounded-md" />
          ))}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 border-b border-[color:var(--border)] bg-[color:var(--surface-chrome)] px-4 sm:px-6 lg:px-8">
          <div className="flex min-h-[var(--header-h)] flex-wrap items-center justify-between gap-2 py-2">
            <div className="flex min-w-0 items-center gap-3 md:hidden">
              <Skeleton aria-hidden="true" className="size-9 shrink-0 rounded-md" />
              <Skeleton aria-hidden="true" className="h-4 w-28" />
            </div>
            <SyntheticMarker className="ml-auto" testId="caring-contacts-loading-synthetic-marker" />
          </div>
        </header>

        <main className="min-w-0 px-4 pb-[calc(var(--spacing-tap)+var(--safe-area-bottom)+1.5rem)] pt-5 sm:px-6 sm:pt-7 md:pb-8 lg:px-8">
          <div aria-hidden="true" className="mx-auto w-full max-w-6xl min-[1440px]:max-w-[90rem]">
            <div className="mb-6 flex flex-col gap-4 border-b border-[color:var(--border)] pb-5 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0 space-y-2">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-4 w-full max-w-[var(--measure)]" />
              </div>
              <Skeleton className="h-tap w-32 shrink-0 rounded-lg" />
            </div>
            <div className="space-y-4">
              <Skeleton className="h-40 w-full rounded-lg" />
              <Skeleton className="h-40 w-full rounded-lg" />
            </div>
          </div>
        </main>
      </div>

      {/* The dock's box, so phone content does not reflow when the real dock arrives. */}
      <div
        aria-hidden="true"
        className="fixed inset-x-0 bottom-0 grid min-h-tap grid-cols-4 border-t border-[color:var(--border)] bg-[color:var(--surface-chrome)] pb-[var(--safe-area-bottom)] md:hidden"
      />
    </div>
  );
}
