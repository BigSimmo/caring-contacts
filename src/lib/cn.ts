import { twMergeClinical } from "@/lib/tailwind-merge";

/**
 * Compose Tailwind classes, resolving conflicts last-wins.
 *
 * Falsy arguments are dropped exactly as before; what changed is that the result
 * now goes through tailwind-merge, so a later class beats an earlier one instead
 * of both being emitted and the generated stylesheet's order deciding. See
 * `@/lib/tailwind-merge` for why the merge needs this repo's `@theme` scales
 * declared to it, and what it silently deletes without them.
 */
export function cn(...classes: Array<string | false | null | undefined>) {
  return twMergeClinical(classes.filter(Boolean).join(" "));
}
