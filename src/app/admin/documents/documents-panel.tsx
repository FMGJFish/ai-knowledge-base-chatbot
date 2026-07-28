"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

type DocumentSummary = {
  id: string;
  filename: string;
  status: string;
  uploadedAt: string;
};

const DOCUMENTS_BUCKET = "documents";
const ACCEPTED_CONTENT_TYPE = "application/pdf";

// Document Management Surface panel (Phase 8, Increment 1). Presentation
// only: every operation below calls one of the already-implemented,
// already-admin-gated Documents/Knowledge Management endpoints exactly as
// they already behave -- no new API route, no new persistence, no new
// business logic. The upload flow follows the existing two-phase,
// direct-to-Supabase-Storage contract (ADR Decision 017) exactly:
// POST /api/v1/documents (authorization) -> direct browser upload to
// Storage using the returned signed URL -> POST /api/v1/documents/complete
// (finalization).
//
// `processing_error` is not displayed here: the current backend API
// contract (GET /api/v1/documents, GET /api/v1/documents/[id]) does not
// expose that field. The Chief Systems Architect formally withdrew this
// as an Increment 1 Success Criterion via Architectural Interpretation,
// since exposing it would require expanding the Phase 4 API contract --
// outside this increment's presentation-layer-only delegated authority.
// Deferred to a future increment that explicitly authorizes backend API
// expansion.
export function DocumentsPanel() {
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadPending, setUploadPending] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadInFlight = useRef(false);

  const [publishPendingId, setPublishPendingId] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  const loadDocuments = useCallback(async () => {
    setListError(null);

    try {
      const response = await fetch("/api/v1/documents");

      if (!response.ok) {
        setListError(`Failed to load documents (status ${response.status}).`);
        return;
      }

      const data = (await response.json()) as { documents: DocumentSummary[] };
      setDocuments(data.documents);
    } catch {
      setListError("Failed to load documents.");
    }
  }, []);

  // Fetch is inlined here (rather than calling loadDocuments() directly)
  // to keep this effect's own setState calls inside the .then() callback
  // with an explicit cancelled guard, matching the pattern already
  // established in widget-app.tsx -- calling a state-setting function
  // synchronously at the top of an effect body is flagged by this
  // project's react-hooks/set-state-in-effect rule.
  useEffect(() => {
    let cancelled = false;

    fetch("/api/v1/documents").then(
      async (response) => {
        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setListError(`Failed to load documents (status ${response.status}).`);
          return;
        }

        const data = (await response.json()) as { documents: DocumentSummary[] };

        if (!cancelled) {
          setDocuments(data.documents);
        }
      },
      () => {
        if (!cancelled) {
          setListError("Failed to load documents.");
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedFile || uploadInFlight.current) {
      return;
    }

    uploadInFlight.current = true;
    setUploadPending(true);
    setUploadError(null);

    try {
      const authorizeResponse = await fetch("/api/v1/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: selectedFile.name,
          contentType: selectedFile.type || ACCEPTED_CONTENT_TYPE,
          declaredSize: selectedFile.size,
        }),
      });

      if (!authorizeResponse.ok) {
        const body = await authorizeResponse.json().catch(() => null);
        setUploadError(
          body?.error ?? `Upload authorization failed (status ${authorizeResponse.status}).`
        );
        return;
      }

      const { supabaseUpload, uploadIntentToken } = (await authorizeResponse.json()) as {
        storagePath: string;
        supabaseUpload: { signedUrl: string; token: string; path: string };
        uploadIntentToken: string;
      };

      const supabase = createBrowserClient();
      const { error: storageError } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .uploadToSignedUrl(supabaseUpload.path, supabaseUpload.token, selectedFile, {
          contentType: selectedFile.type || ACCEPTED_CONTENT_TYPE,
        });

      if (storageError) {
        setUploadError(`Upload to storage failed: ${storageError.message}`);
        return;
      }

      const completeResponse = await fetch("/api/v1/documents/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadIntentToken }),
      });

      if (!completeResponse.ok) {
        const body = await completeResponse.json().catch(() => null);
        setUploadError(
          body?.error ?? `Upload completion failed (status ${completeResponse.status}).`
        );
        return;
      }

      setSelectedFile(null);
      await loadDocuments();
    } catch {
      setUploadError("Upload failed.");
    } finally {
      uploadInFlight.current = false;
      setUploadPending(false);
    }
  }

  async function handlePublish(documentId: string) {
    if (publishPendingId) {
      return;
    }

    setPublishPendingId(documentId);
    setPublishError(null);

    try {
      const response = await fetch(`/api/v1/knowledge/${documentId}/publish`, {
        method: "POST",
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setPublishError(body?.error ?? `Publish failed (status ${response.status}).`);
        return;
      }

      await loadDocuments();
    } catch {
      setPublishError("Publish failed.");
    } finally {
      setPublishPendingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleUpload} className="flex items-center gap-3">
        <input
          type="file"
          accept="application/pdf"
          onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
          disabled={uploadPending}
        />
        <button
          type="submit"
          disabled={!selectedFile || uploadPending}
          className="rounded border px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploadPending ? "Uploading…" : "Upload"}
        </button>
      </form>

      {uploadError ? (
        <p role="alert" className="text-sm text-red-700">
          {uploadError}
        </p>
      ) : null}

      {publishError ? (
        <p role="alert" className="text-sm text-red-700">
          {publishError}
        </p>
      ) : null}

      {listError ? (
        <p role="alert" className="text-sm text-red-700">
          {listError}
        </p>
      ) : null}

      {documents === null && !listError ? <p>Loading documents…</p> : null}

      {documents && documents.length === 0 ? <p>No documents uploaded yet.</p> : null}

      {documents && documents.length > 0 ? (
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2">Filename</th>
              <th className="py-2">Status</th>
              <th className="py-2">Uploaded</th>
              <th className="py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((document) => (
              <tr key={document.id} className="border-b">
                <td className="py-2">{document.filename}</td>
                <td className="py-2">{document.status}</td>
                <td className="py-2">{new Date(document.uploadedAt).toLocaleString()}</td>
                <td className="py-2">
                  {document.status === "ready_for_review" ? (
                    <button
                      type="button"
                      onClick={() => handlePublish(document.id)}
                      disabled={publishPendingId === document.id}
                      className="rounded border px-3 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {publishPendingId === document.id ? "Publishing…" : "Publish"}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
