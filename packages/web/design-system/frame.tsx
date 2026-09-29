/** The pieces a demo is laid out with: a titled section of rows, each row a label and its examples. */
import type { ReactNode } from "react";

export const Section = ({ title, children }: { readonly title: string; readonly children: ReactNode }) => (
  <section className="flex flex-col gap-3">
    <h3 className="m-0 font-medium text-muted-foreground text-xs uppercase tracking-wide">{title}</h3>
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">{children}</div>
  </section>
);

export const Row = ({ label, children }: { readonly label: string; readonly children: ReactNode }) => (
  <div className="grid grid-cols-[9rem_1fr] items-center gap-4">
    <span className="font-mono text-muted-foreground text-xs">{label}</span>
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  </div>
);

export const Demos = ({ children }: { readonly children: ReactNode }) => <div className="flex flex-col gap-6">{children}</div>;
