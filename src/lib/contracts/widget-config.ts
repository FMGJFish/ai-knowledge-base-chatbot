// Shared Widget Configuration contract (Phase 7, Increment 3, Task 4A).
// Neutral contract layer: no "server-only" marker and no runtime logic, so
// it is safe to import from both the server-side Widget Configuration
// Service and the browser-side widget client. The server service remains
// the sole producer of this shape; this module only names it.
export type PublicWidgetConfiguration = {
  name: string;
  welcomeMessage: string | null;
};
