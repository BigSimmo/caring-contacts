// tests/helpers/strip-source-comments.ts
//
// Removes comments from TypeScript/TSX source, leaving string and template literals intact.
//
// WHY THIS EXISTS, AND WHY IT IS NOT A REGEX. Two guards in this repo scan source text for a
// forbidden name -- `tests/caring-contacts-explained-automation.dom.test.tsx` looks for the
// service-state record in a client component's whole module graph, and
// `tests/caring-contacts-plan-draft.dom.test.tsx` looks for `localStorage` anywhere in the
// activation wizard. Both have to read CODE rather than prose, because both files they scan
// explain in comments exactly why the forbidden thing is forbidden, and a raw text match reports
// the explanation as the offence. The fix for that must never be to delete the explanation:
// `tests/route-reachability.test.ts` records the same trap in its own words, having once passed
// with a real link mutated away because a comment satisfied its regex.
//
// The first version stripped block comments with `/\/\*[\s\S]*?\*\//g`. Round 1, finding M-4: that
// regex is not literal-aware, so a `"/*"` inside an ordinary string blanks every line of REAL CODE
// up to the next `*/` -- a silent false negative inside a safety guard, which is the worst shape a
// defect in a check can take. This scans character by character instead and copies literals through
// untouched.
//
// FOUR PLACES IT IS INEXACT. THREE ERR TOWARD LEAVING TEXT IN, WHICH IS THE SAFE DIRECTION for a
// guard: a false alarm a human reads, rather than a missed offence that passes silently. Do not
// "fix" any of the three by loosening it. THE FOURTH ERRS THE OTHER WAY and is a known limitation
// rather than a design choice — round 2, item 4.
//
// Safe direction:
//
//   * A LINE COMMENT IS STRIPPED ONLY WHEN THE LINE BEGINS WITH `//`. A trailing
//     `import … // service-state` keeps its comment, so a guard still fires on it. That property
//     was in the regex this replaces and was deliberately kept: hardening the block-comment case
//     is not a licence to widen the line-comment one.
//   * A REGULAR-EXPRESSION LITERAL IS NOT MODELLED, so a regex containing an unescaped `/*` or
//     `//` is treated as code and could swallow the rest of its line.
//   * AN UNTERMINATED STRING ENDS AT THE NEWLINE rather than running to the end of the file.
//
// UNSAFE DIRECTION — the one to know about:
//
//   * A TRAILING LINE COMMENT THAT CONTAINS `/*` IS NOT STRIPPED AS A COMMENT (see the first bullet)
//     BUT ITS `/*` STILL OPENS THE BLOCK BRANCH, so everything up to the next `*/` — real code
//     included — is removed from what the guard reads. That is a silent false negative, which is the
//     worst shape a defect in a check can take, and it is exactly the class of bug this whole helper
//     was written to fix (M-4) reappearing one layer down.
//
//     It is left in because closing it means teaching the line-comment branch to consume a trailing
//     comment's text without stripping it — a real change to the deliberate first bullet, not a
//     tweak — and because the shape needed to trigger it (a trailing `//` comment containing `/*`,
//     with a later `*/` in the file) does not occur in either scanned tree today. The case named
//     `pins the one place it errs UNSAFELY, so a green suite cannot be read as closing it` in
//     `tests/caring-contacts-explained-automation.dom.test.tsx` pins the CURRENT behaviour and is
//     labelled as pinning a limitation, so nobody can conclude from a green suite that it is closed.
//     Tighten it deliberately, with that test rewritten to the new behaviour, or leave it alone.

// Named rather than written as backslash escapes. A newline escape inside a source string is
// exactly what a careless scripted rewrite of this file turns into a real line break, and it did —
// twice — while this helper was being written.
const LINE_FEED = String.fromCharCode(10);
const TAB = String.fromCharCode(9);
const CARRIAGE_RETURN = String.fromCharCode(13);

type Frame = { mode: "code" | "template" | "interpolation"; depth: number };

/** True when everything before `index` on this line is whitespace. */
function atLineStart(source: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i -= 1) {
    const ch = source[i];
    if (ch === LINE_FEED) return true;
    if (ch !== " " && ch !== TAB && ch !== CARRIAGE_RETURN) return false;
  }
  return true;
}

/**
 * Blanks CSS comments IN PLACE, preserving every newline and every column.
 *
 * ⚠️ WHY BLANKING RATHER THAN DELETING. A guard that strips comments by deleting them reports the
 * WRONG LINE NUMBER for everything below the first comment, and a guard that names the wrong line
 * is worse than one that names none — the reader goes to that line, finds nothing, and concludes
 * the guard is broken rather than that the file is. Replacing each comment character with a space
 * and each newline with itself keeps every subsequent offset exact.
 *
 * CSS only: `/* … *\/` is the only comment form in CSS, and a `//` in a stylesheet is part of a
 * URL far more often than it is a comment.
 */
export function blankCssComments(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2);
      const stop = end === -1 ? css.length : end + 2;
      for (let j = i; j < stop; j += 1) out += css[j] === LINE_FEED ? LINE_FEED : " ";
      i = stop;
      continue;
    }
    out += css[i];
    i += 1;
  }
  return out;
}

/**
 * Strips comments INCLUDING trailing ones. Same character-by-character, literal-aware scan as
 * `stripSourceComments`; the only difference is that a `//` does not have to start its line.
 *
 * 🔴 WHY THIS IS A SECOND FUNCTION RATHER THAN A FLAG ON THE FIRST. `stripSourceComments` keeps a
 * trailing comment ON PURPOSE — three caring-contacts guards rely on still firing when a forbidden
 * name appears in one, and one of them pins that behaviour. Widening the shared function would
 * silently change what those guards catch. So the wider scan is opt-in, and only for guards where
 * the realistic defect is CODE COMMENTED OUT rather than prose mentioning a name.
 *
 * ⚠️ USE IT ONLY FOR GUARDS THAT WATCH A CODE WRITE. For a guard watching prose or structure, the
 * narrower function is sufficient, and a second mechanism is a second thing to keep true.
 *
 * The reason it is safe to widen here at all is that this scan is STRING-AWARE: a `"https://x"`
 * is copied through as a string literal, so the `//` inside a URL is never mistaken for a comment.
 * A regex-based widening could not make that claim, which is what the note above warns against.
 */
export function stripAllComments(source: string): string {
  return scan(source, true);
}

export function stripSourceComments(source: string): string {
  return scan(source, false);
}

function scan(source: string, stripTrailingLineComments: boolean): string {
  let out = "";
  let i = 0;
  const n = source.length;
  const stack: Frame[] = [{ mode: "code", depth: 0 }];

  const top = (): Frame => stack[stack.length - 1]!;

  while (i < n) {
    const frame = top();

    if (frame.mode === "template") {
      if (source[i] === "\\") {
        out += source.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (source.startsWith("${", i)) {
        out += "${";
        i += 2;
        stack.push({ mode: "interpolation", depth: 0 });
        continue;
      }
      if (source[i] === "`") {
        out += "`";
        i += 1;
        stack.pop();
        continue;
      }
      out += source[i];
      i += 1;
      continue;
    }

    // Code, or the code inside a `${ ... }`.
    if (source.startsWith("//", i) && (stripTrailingLineComments || atLineStart(source, i))) {
      const end = source.indexOf(LINE_FEED, i);
      i = end === -1 ? n : end;
      continue;
    }
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }

    const ch = source[i]!;
    if (ch === '"' || ch === "'") {
      out += ch;
      i += 1;
      while (i < n) {
        const inner = source[i]!;
        if (inner === "\\") {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += inner;
        i += 1;
        if (inner === ch || inner === LINE_FEED) break;
      }
      continue;
    }
    if (ch === "`") {
      out += ch;
      i += 1;
      stack.push({ mode: "template", depth: 0 });
      continue;
    }
    if (frame.mode === "interpolation") {
      if (ch === "{") frame.depth += 1;
      else if (ch === "}") {
        if (frame.depth === 0) {
          out += ch;
          i += 1;
          stack.pop();
          continue;
        }
        frame.depth -= 1;
      }
    }
    out += ch;
    i += 1;
  }

  return out;
}
