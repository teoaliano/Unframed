import { Skeleton } from "~/components/ui/skeleton";
import { Demos, Row, Section } from "../frame.tsx";

export default function SkeletonDemo() {
  return (
    <Demos>
      <Section title="Shapes">
        <Row label="block">
          <Skeleton className="h-4 w-40" />
        </Row>
        <Row label="card">
          <Skeleton shape="card" className="h-24 w-40" />
        </Row>
        <Row label="pill">
          <Skeleton shape="pill" className="h-6 w-20" />
          <Skeleton shape="pill" className="size-8" />
        </Row>
      </Section>
      <Section title="Composed">
        <Row label="preset card">
          <div className="flex w-64 flex-col gap-2 rounded-lg border p-3">
            <Skeleton shape="card" className="h-28 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <div className="flex gap-1">
              <Skeleton shape="pill" className="h-4 w-14" />
              <Skeleton shape="pill" className="h-4 w-12" />
            </div>
          </div>
        </Row>
        <Row label="list rows">
          <div className="flex w-72 flex-col gap-2">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center gap-2">
                <Skeleton shape="pill" className="size-6" />
                <Skeleton className="h-3.5 flex-1" />
              </div>
            ))}
          </div>
        </Row>
      </Section>
    </Demos>
  );
}
