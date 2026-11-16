"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebase/firebaseConfig";
import { MEDIA_RETENTION_MS, type MediaContent } from "@/lib/whatsapp/message-content";

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "expired" }
  /** `unplayable`: the bytes arrived but the browser can't display them. */
  | { status: "error"; message: string; unplayable?: boolean };

type Props = {
  conversationId: string;
  messageId: string;
  media: MediaContent;
  /** When the customer sent it; media older than WhatsApp keeps it isn't auto-loaded. */
  sentAtMs?: number;
};

/** Formats WhatsApp accepts that browsers generally can't play inline. */
const DOWNLOAD_ONLY_TYPES = new Set(["audio/amr", "video/3gpp"]);

const FILE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
};

function baseMimeType(media: MediaContent): string | undefined {
  return media.mimeType?.split(";")[0]?.trim().toLowerCase();
}

function downloadName(media: MediaContent): string {
  if (media.filename) return media.filename;
  const mime = baseMimeType(media);
  const extension = mime && Object.hasOwn(FILE_EXTENSIONS, mime) ? FILE_EXTENSIONS[mime] : "bin";
  return `whatsapp-${media.type}.${extension}`;
}

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

/** Fetch an inbound message's media through the authenticated media route. */
async function fetchMediaBlob(
  conversationId: string,
  messageId: string,
  signal?: AbortSignal
): Promise<Blob> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error("Sign in again to load media.");
  const idToken = await user.getIdToken();
  const query = new URLSearchParams({ conversation: conversationId, message: messageId });
  const res = await fetch(`/api/whatsapp/media?${query.toString()}`, {
    headers: { Authorization: `Bearer ${idToken}` },
    signal,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Could not load media (HTTP ${res.status}).`);
  }
  return res.blob();
}

const BUTTON_CLASS =
  "inline-flex max-w-full items-center gap-2 rounded-lg border border-black/10 bg-white/70 px-3 py-2 text-left text-xs font-medium text-zinc-800 transition hover:bg-white disabled:opacity-60 dark:border-white/10 dark:bg-zinc-900/60 dark:text-zinc-100 dark:hover:bg-zinc-900";
const LINK_BUTTON_CLASS = "font-medium text-zinc-700 underline dark:text-zinc-200";

/**
 * Shows the media of an inbound message. Photos and stickers load when they
 * scroll into view; audio and video load on click; documents (and formats
 * browsers can't play) are downloaded. Media is fetched with the operator's ID
 * token and shown through blob: URLs that are revoked on unmount.
 */
export function MediaAttachment({ conversationId, messageId, media, sentAtMs }: Props) {
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      previewAbortRef.current?.abort();
      previewAbortRef.current = null;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  /** Load the media for inline display. Cancelled if the bubble unmounts. */
  const loadPreview = useCallback(async () => {
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    setPreview({ status: "loading" });
    try {
      const blob = await fetchMediaBlob(conversationId, messageId, controller.signal);
      if (!mountedRef.current || controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = url;
      setPreview({ status: "ready", url });
    } catch (e) {
      if (isAbortError(e) || !mountedRef.current) return;
      setPreview({ status: "error", message: errorMessage(e, "Could not load media.") });
    } finally {
      if (previewAbortRef.current === controller) previewAbortRef.current = null;
    }
  }, [conversationId, messageId]);

  /**
   * Save the file to disk. Deliberately not cancelled on unmount: the operator
   * asked for it, so it still completes if they switch conversations.
   */
  const saveFile = useCallback(async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      const blob = await fetchMediaBlob(conversationId, messageId);
      // An opaque type makes the browser save the file instead of opening it
      // on this origin, whatever the customer actually sent.
      const url = URL.createObjectURL(new Blob([blob], { type: "application/octet-stream" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadName(media);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      if (mountedRef.current) setDownloadError(errorMessage(e, "Could not download the file."));
    } finally {
      if (mountedRef.current) setDownloading(false);
    }
  }, [conversationId, messageId, media]);

  const isPhoto = media.type === "image" || media.type === "sticker";
  const mime = baseMimeType(media);
  const downloadOnly =
    media.type === "document" || (mime !== undefined && DOWNLOAD_ONLY_TYPES.has(mime));

  // Load photos and stickers only once they are close to the viewport, so a
  // long thread doesn't download every image at once. Media older than
  // WhatsApp's retention period is very likely gone, so ask before trying.
  useEffect(() => {
    if (!isPhoto || preview.status !== "idle") return;
    const element = containerRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        if (sentAtMs !== undefined && Date.now() - sentAtMs > MEDIA_RETENTION_MS) {
          setPreview({ status: "expired" });
        } else {
          void loadPreview();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [isPhoto, preview.status, loadPreview, sentAtMs]);

  const showUnplayable = () =>
    setPreview({ status: "error", message: "This browser can't open this file.", unplayable: true });

  const downloadLink = (
    <button type="button" onClick={() => void saveFile()} disabled={downloading} className={LINK_BUTTON_CLASS}>
      {downloading ? "Downloading…" : "Download"}
    </button>
  );

  if (isPhoto) {
    const sticker = media.type === "sticker";
    // The box keeps the same height before and after loading, so a photo
    // appearing doesn't push the newest messages and the reply box down.
    const boxClass = sticker ? "h-32 w-32" : "h-60 w-56 max-w-full";
    if (preview.status === "ready") {
      return (
        // eslint-disable-next-line @next/next/no-img-element -- blob: URL from an authenticated fetch; next/image can't optimize it
        <img
          src={preview.url}
          alt={media.caption ?? (sticker ? "Sticker" : "Photo")}
          onError={showUnplayable}
          className={sticker ? "h-32 w-32 object-contain" : "h-60 w-auto max-w-full rounded-lg object-contain"}
        />
      );
    }
    return (
      <div
        ref={containerRef}
        className={`flex flex-col items-center justify-center gap-1 rounded-lg bg-black/5 px-3 text-center text-xs text-zinc-500 dark:bg-white/5 dark:text-zinc-400 ${boxClass}`}
      >
        {preview.status === "expired" ? (
          <>
            <span>WhatsApp only keeps media for 7 days, so this has probably expired.</span>
            <button type="button" onClick={() => void loadPreview()} className={LINK_BUTTON_CLASS}>
              Try anyway
            </button>
          </>
        ) : preview.status === "error" ? (
          <>
            <span>{preview.message}</span>
            {preview.unplayable ? (
              downloadLink
            ) : (
              <button type="button" onClick={() => void loadPreview()} className={LINK_BUTTON_CLASS}>
                Retry
              </button>
            )}
            {downloadError && <span className="text-red-600 dark:text-red-400">{downloadError}</span>}
          </>
        ) : (
          <span>{sticker ? "Loading sticker…" : "Loading photo…"}</span>
        )}
      </div>
    );
  }

  if (!downloadOnly && preview.status === "ready") {
    return media.type === "audio" ? (
      <audio controls autoPlay src={preview.url} onError={showUnplayable} className="w-64 max-w-full" />
    ) : (
      <video
        controls
        autoPlay
        playsInline
        src={preview.url}
        onError={showUnplayable}
        className="max-h-72 max-w-full rounded-lg"
      />
    );
  }

  // Once the browser has failed to play a file, offer only the download:
  // playing again would fetch the whole file just to fail again.
  const saves = downloadOnly || (preview.status === "error" && preview.unplayable === true);
  const format = mime?.split("/")[1]?.toUpperCase();
  const label = saves
    ? media.type === "document"
      ? media.filename || "Download document"
      : `Download ${media.voice ? "voice message" : media.type}${format ? ` (${format})` : ""}`
    : media.type === "video"
      ? "Play video"
      : media.voice
        ? "Play voice message"
        : "Play audio";
  const busy = downloading || preview.status === "loading";

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => void (saves ? saveFile() : loadPreview())}
        disabled={busy}
        className={BUTTON_CLASS}
      >
        <span aria-hidden="true">{saves ? "⬇" : "▶"}</span>
        <span className="truncate">
          {downloading ? "Downloading…" : preview.status === "loading" ? "Loading…" : label}
        </span>
      </button>
      {preview.status === "error" && (
        <p className="text-[11px] text-red-600 dark:text-red-400">{preview.message}</p>
      )}
      {downloadError && (
        <p className="text-[11px] text-red-600 dark:text-red-400">{downloadError}</p>
      )}
    </div>
  );
}
