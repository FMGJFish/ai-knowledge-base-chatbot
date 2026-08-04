import { listEvents, type AnalyticsEventSummary } from "@/lib/services/analytics/analytics";

// Analytics Panel (Implementation Roadmap Phase 9, Increment 4). Server
// Component -- no "use client" directive -- calling listEvents() directly
// per this session's Applied Interpretation: an in-process server-side
// dependency on the owning Analytics Service, not direct database access
// and not an internal HTTP self-call to /api/v1/analytics. Presentation
// only: no filtering, pagination, sorting, aggregation, joins, mutation,
// or additional fields beyond listEvents()'s existing five-field,
// occurredAt-descending contract.
function formatReference(referenceType: string | null, referenceId: string | null): string {
  if (referenceType && referenceId) {
    return `${referenceType}: ${referenceId}`;
  }

  if (referenceType) {
    return referenceType;
  }

  if (referenceId) {
    return referenceId;
  }

  return "—";
}

export async function AnalyticsPanel() {
  let events: AnalyticsEventSummary[];

  try {
    events = await listEvents();
  } catch {
    return (
      <p role="alert" className="text-sm text-red-700">
        Failed to load analytics.
      </p>
    );
  }

  if (events.length === 0) {
    return <p>No analytics events recorded yet.</p>;
  }

  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead>
        <tr className="border-b">
          <th className="py-2">Event Type</th>
          <th className="py-2">Reference</th>
          <th className="py-2">Occurred At</th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => (
          <tr key={event.id} className="border-b">
            <td className="py-2">{event.eventType}</td>
            <td className="py-2">{formatReference(event.referenceType, event.referenceId)}</td>
            <td className="py-2">{new Date(event.occurredAt).toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
