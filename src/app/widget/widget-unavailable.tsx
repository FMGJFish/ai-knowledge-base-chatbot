// Rendered when the widget cannot identify which chatbot it belongs to --
// either because no Public Chatbot Identifier was supplied on the /widget
// URL at all (checked server-side in page.tsx, no network call made), or
// because the identifier was rejected by the Widget Configuration
// endpoint as malformed or unresolvable (checked client-side in
// widget-app.tsx after a real request). Both cases present identically:
// AD-028 does not distinguish them to the client beyond an error code,
// and neither is an authentication failure worth exposing detail about.
export function WidgetUnavailable() {
  return (
    <div role="alert" className="p-4 text-sm text-gray-700">
      This chat widget is not available right now.
    </div>
  );
}
