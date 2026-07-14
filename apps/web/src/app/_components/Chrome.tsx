import type { ReactNode } from "react";

/** Sticky mono side-label for the editorial section scaffold. */
export function SectionSide({
  index,
  kicker,
  tone,
}: {
  index: string;
  kicker: string;
  tone?: "green" | "cyan" | "violet" | "amber";
}) {
  return (
    <div className="sec-side">
      <span className="sec-index mono">{index}</span>
      <span className={`sec-kicker mono ${tone ? `lp-tone-${tone}` : ""}`}>
        {kicker}
      </span>
    </div>
  );
}

/** Numbered full-bleed section: hairline top border + framed content. */
export function Section({
  index,
  kicker,
  tone,
  children,
}: {
  index: string;
  kicker: string;
  tone?: "green" | "cyan" | "violet" | "amber";
  children: ReactNode;
}) {
  return (
    <section className="sec">
      <div className="inner sec-grid">
        <SectionSide index={index} kicker={kicker} tone={tone} />
        <div className="sec-main">{children}</div>
      </div>
    </section>
  );
}

/** Subpage hero band: kicker rule, display heading, dim sub. */
export function PageHero({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="page-hero">
      <div className="inner">
        <p className="page-kicker">{kicker}</p>
        <h1 className="page-h1">{title}</h1>
        {children ? <p className="page-sub">{children}</p> : null}
      </div>
    </section>
  );
}

/** One cell of the full-bleed stat strip. */
export function StatCell({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="statcell">
      <div className={`statcell-v ${accent ? "accent" : ""}`}>{value}</div>
      <div className="statcell-l">{label}</div>
      {hint ? <div className="statcell-hint">{hint}</div> : null}
    </div>
  );
}

/** Full-bleed stat strip; wrap StatCells. */
export function StatBar({ children }: { children: ReactNode }) {
  return (
    <section className="statbar">
      <div className="inner">
        <div className="statbar-grid cols-4">{children}</div>
      </div>
    </section>
  );
}
