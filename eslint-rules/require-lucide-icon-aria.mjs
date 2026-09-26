/**
 * Local ESLint rule: a lucide-react icon rendered as a JSX element must declare
 * its accessibility intent — either `aria-hidden` (decorative, the common case)
 * or an accessible name (`aria-label` / `aria-labelledby` / `role` / `title`).
 *
 * This enforces the codebase's existing convention so a decorative glyph can't
 * silently reach the accessibility tree.
 *
 * Three tag shapes are in scope:
 *
 *  1. A tag name imported directly as a value from "lucide-react"
 *     (`<ChevronRight />`). Always in scope, whatever the local name.
 *
 *  2. A tag name ending in `Icon` — `Icon`, `ActiveIcon`, but also the many
 *     other names this codebase gives an icon received as a value
 *     (`HitIcon`, `GroupIcon`, `SelectedTabIcon`, `TitleIcon`, `RowIcon`,
 *     `TrailingIcon`, …). Matching the whole `*Icon` suffix rather than a
 *     hard-coded `Icon`/`ActiveIcon` pair is what closes the old blind spot:
 *     the same `const Icon = item.icon` pattern under any other local name was
 *     previously invisible to the gate.
 *
 *  3. A member-expression tag whose PROPERTY is `icon` or `Icon` —
 *     `<item.icon />`, `<r.icon />`, `<config.Icon />`. This is the same
 *     "icon held in a value" pattern rendered without the intermediate `const`,
 *     and the rule used to bail on every member tag. Only the icon-shaped
 *     property is matched, so `<Foo.Provider />` and `<motion.div />` stay out
 *     of scope.
 *
 * WRAPPER-COMPONENT EXCLUSION. Shape 2 would otherwise fire on components whose
 * name merely ends in `Icon` but which render an already-marked svg internally
 * (`ToolIcon`, `ProviderBrandIcon`, `SupportStatusIcon`, `NoticeIcon`, …);
 * requiring aria-hidden at their call sites would be wrong. Rather than an
 * allowlist that has to be maintained by hand, the rule resolves the tag name
 * through ESLint scope analysis and skips it when it resolves to a component
 * DECLARED in the same module — a function/class declaration, or a `const` bound
 * to a function, arrow, class, or a `memo(…)` / `forwardRef(…)` wrapper. A name
 * bound to a member expression (`const Icon = item.icon`), to a parameter or
 * destructured prop (`{ icon: Icon }`), or to a conditional stays in scope,
 * because those hold an icon value rather than name a component. Imported
 * bindings are also skipped: the rule cannot see the other module, and an
 * imported `*Icon` is far more often a wrapper than a bare re-exported glyph.
 * That is the one deliberate blind spot left, and it fails toward silence
 * rather than toward noise. It costs nothing today — `src/` currently has no
 * `*Icon` imported from anywhere but lucide-react, and lucide value imports are
 * matched first, so the skip cannot swallow them.
 *
 * Two shapes `isComponentInitializer` deliberately does NOT treat as components,
 * both of which would be false positives if they appeared: a plain alias to a
 * declared component (`const AliasIcon = RealIcon`) and a non-memo/forwardRef HOC
 * (`styled(Foo)`, `withTheme(Foo)`). Neither exists in this repo — there is no
 * styled-components dependency, and all `*Icon` wrappers are plain `function`
 * declarations. Widening the check to bare identifier initialisers would be the
 * wrong trade: `const Icon = someIconValue` is the exact shape this rule exists to
 * catch, and it is indistinguishable from an alias without type information. If a
 * real alias-to-wrapper ever appears, name it something that does not end in `Icon`
 * or mark the glyph at its source, rather than loosening this test. Later
 * re-assignment (`let Icon = A; Icon = B`) is likewise untracked; only the
 * declaration's initialiser is read.
 *
 * All three shapes get the same autofix, which inserts aria-hidden="true".
 * Elements that spread props ({...rest}) are skipped, since the aria attribute
 * may arrive dynamically.
 *
 * Mockups are exempt at the config level, not here: eslint.config.mjs applies
 * the shared MOCKUP_IGNORES globs to this rule, so design-scratch previews sit
 * outside the gate rather than being a coverage gap.
 */

const ACCESSIBILITY_ATTRS = new Set(["aria-hidden", "aria-label", "aria-labelledby", "role", "title"]);

/** JSX member tags treated as an icon value: `<x.icon />` / `<x.Icon />`. */
const ICON_PROPERTY_NAMES = new Set(["icon", "Icon"]);

/** Calls that wrap a component and keep it a component. */
const COMPONENT_WRAPPER_CALLEES = new Set(["memo", "forwardRef"]);

/** `<a.b.icon />` → "a.b.icon", for the report message. */
function serializeTagName(nameNode) {
  if (nameNode.type === "JSXIdentifier") return nameNode.name;
  if (nameNode.type === "JSXNamespacedName") return `${nameNode.namespace.name}:${nameNode.name.name}`;
  return `${serializeTagName(nameNode.object)}.${nameNode.property.name}`;
}

function findVariable(scope, name) {
  for (let current = scope; current; current = current.upper) {
    const variable = current.set.get(name);
    if (variable) return variable;
  }
  return null;
}

/** True when `init` names a component rather than holding an icon value. */
function isComponentInitializer(init) {
  if (!init) return false;
  switch (init.type) {
    case "ArrowFunctionExpression":
    case "FunctionExpression":
    case "ClassExpression":
      return true;
    case "CallExpression": {
      const callee = init.callee;
      if (callee.type === "Identifier") return COMPONENT_WRAPPER_CALLEES.has(callee.name);
      if (callee.type === "MemberExpression" && callee.property.type === "Identifier") {
        return COMPONENT_WRAPPER_CALLEES.has(callee.property.name);
      }
      return false;
    }
    default:
      return false;
  }
}

/**
 * True when `name` resolves, at this JSX site, to something the rule should not
 * hold to the icon contract: a component declared in this module, or a binding
 * imported from another one.
 */
function resolvesToComponentOrImport(context, node, name) {
  const variable = findVariable(context.sourceCode.getScope(node), name);
  if (!variable) return false; // unresolved — hold it to the contract
  return variable.defs.some((def) => {
    switch (def.type) {
      case "FunctionName":
      case "ClassName":
      case "ImportBinding":
        return true;
      case "Variable":
        return isComponentInitializer(def.node.init);
      default:
        // Parameter, CatchClause, ImplicitGlobalVariable: an icon value, not a
        // component declaration.
        return false;
    }
  });
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    // Auto-fix adds aria-hidden="true" (the decorative default). Safe: a bare
    // lucide <svg> has no accessible name, so hiding it never removes a control's
    // name — an icon-only button that needs a name was already unlabeled and is
    // caught separately by runtime axe checks.
    fixable: "code",
    docs: {
      description: "Require lucide-react icons to be decorative (aria-hidden) or to carry an accessible name.",
    },
    schema: [],
    messages: {
      missing:
        'Lucide icon <{{name}}> needs aria-hidden="true" (if decorative) or an accessible name (aria-label / aria-labelledby / role / title).',
    },
  },
  create(context) {
    /** Local identifiers imported as values from lucide-react. */
    const lucideValueImports = new Set();

    /** Does this tag render an icon the rule must hold to the contract? */
    function isIconTag(node) {
      const nameNode = node.name;
      if (nameNode.type === "JSXMemberExpression") {
        return nameNode.property.type === "JSXIdentifier" && ICON_PROPERTY_NAMES.has(nameNode.property.name);
      }
      if (nameNode.type !== "JSXIdentifier") return false;
      if (lucideValueImports.has(nameNode.name)) return true;
      if (!nameNode.name.endsWith("Icon")) return false;
      return !resolvesToComponentOrImport(context, node, nameNode.name);
    }

    return {
      ImportDeclaration(node) {
        if (node.source.value !== "lucide-react") return;
        if (node.importKind === "type") return; // whole `import type { … }`
        for (const spec of node.specifiers) {
          if (spec.type !== "ImportSpecifier" && spec.type !== "ImportDefaultSpecifier") continue;
          if (spec.importKind === "type") continue; // inline `type X`
          lucideValueImports.add(spec.local.name);
        }
      },
      JSXOpeningElement(node) {
        if (!isIconTag(node)) return;
        // A spread ({...props}) may inject aria-* dynamically — don't flag.
        if (node.attributes.some((attr) => attr.type === "JSXSpreadAttribute")) return;
        const declaresIntent = node.attributes.some(
          (attr) =>
            attr.type === "JSXAttribute" &&
            attr.name.type === "JSXIdentifier" &&
            ACCESSIBILITY_ATTRS.has(attr.name.name),
        );
        if (declaresIntent) return;
        context.report({
          node,
          messageId: "missing",
          data: { name: serializeTagName(node.name) },
          fix: (fixer) => fixer.insertTextAfter(node.name, ' aria-hidden="true"'),
        });
      },
    };
  },
};

export default rule;
