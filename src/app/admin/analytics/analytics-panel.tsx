// Static presentation scaffold (Implementation Roadmap Phase 8, Increment
// 4). Server Component -- no "use client" directive -- because this
// increment's approved behavior requires none of the capabilities that
// would justify one: no state, no effects, no browser APIs, no event
// handlers, no network calls. Phase 9 populates this surface by rewriting
// this file's internals only; the route and navigation entry do not
// change.
export function AnalyticsPanel() {
  return (
    <p>
      Analytics reporting is not yet available. This capability will be implemented in a future
      phase.
    </p>
  );
}
