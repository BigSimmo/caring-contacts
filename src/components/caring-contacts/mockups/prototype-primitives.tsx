import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Chip, type ChipStatusTone } from "@/components/ui/chip";

export function SpecimenPanel({
  title,
  description,
  icon: Icon,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`min-w-0 rounded-[var(--radius-xl)] border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-[var(--pad-panel)] ${className}`}
    >
      <header className="mb-[var(--gap-block)] flex min-w-0 items-start gap-[var(--gap-inline)]">
        {Icon ? (
          <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] forced-colors:border forced-colors:border-[CanvasText]">
            <Icon aria-hidden="true" className="size-icon-md" />
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight text-[color:var(--text)]">{title}</h2>
          {description ? (
            <p className="mt-1 max-w-[var(--measure)] text-sm text-[color:var(--text-muted)]">{description}</p>
          ) : null}
        </div>
      </header>
      {children}
    </section>
  );
}

export function SpecimenLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--text-muted)]">
      {children}
    </p>
  );
}

export function OperationalStatus({ children, tone }: { children: ReactNode; tone: ChipStatusTone }) {
  return (
    <Chip appearance={{ kind: "status", tone }} dot>
      {children}
    </Chip>
  );
}

export function DefinitionRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1 border-t border-[color:var(--border)] py-[var(--gap-inline)] first:border-t-0 md:grid-cols-[minmax(8rem,0.7fr)_minmax(0,1.3fr)] md:gap-[var(--gap-block)]">
      <dt className="font-medium text-[color:var(--text)]">{term}</dt>
      <dd className="min-w-0 text-[color:var(--text-muted)]">{children}</dd>
    </div>
  );
}
