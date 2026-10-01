import { useCallback, useEffect, useRef, useState } from "react";

interface Photo {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
}

interface Pending {
  key: string;
  name: string;
  progress: number;
  status: "waiting" | "resizing" | "uploading" | "error";
  error?: string;
}

interface Props {
  endpoint: string;
  initialPhotos: Photo[];
  min: number;
  max: number;
}

const LONG_EDGE = 2400;
const QUALITY = 0.85;
const CONCURRENCY = 2;

const SHOT_LIST = [
  "Front three quarter",
  "Rear three quarter",
  "Both sides",
  "Interior, front and rear",
  "Dash and odometer",
  "Engine bay",
  "Underside",
  "Wheels and tires",
  "Flaws up close",
  "Title, with personal info covered",
];

/**
 * Resize to a 2400px long edge JPEG through a canvas. Re-encoding drops all
 * EXIF data, including GPS location, which protects the seller's privacy.
 */
async function resizePhoto(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const src = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    // Browsers apply the EXIF orientation when drawing, so no rotation needed.
    const scale = Math.min(1, LONG_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.round(img.naturalWidth * scale);
    const height = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    canvas.width = canvas.height = 0; // free memory right away on phones
    if (!blob) throw new Error("encode");
    return { blob, width, height };
  } finally {
    URL.revokeObjectURL(src);
  }
}

function uploadBlob(
  endpoint: string,
  blob: Blob,
  width: number,
  height: number,
  onProgress: (fraction: number) => void,
): Promise<Photo> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${endpoint}?w=${width}&h=${height}`);
    xhr.setRequestHeader("Content-Type", "image/jpeg");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && body?.photo) resolve(body.photo);
      else reject(new Error(body?.error ?? "Upload failed. Try again."));
    };
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.send(blob);
  });
}

export default function PhotoUploader({ endpoint, initialPhotos, min, max }: Props) {
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos);
  const [pending, setPending] = useState<Pending[]>([]);
  const [message, setMessage] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const photosRef = useRef(photos);
  photosRef.current = photos;

  const busy = pending.some((p) => p.status !== "error");

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (busy) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const saveOrder = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const res = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: photosRef.current.map((p) => p.id) }),
      }).catch(() => null);
      if (!res?.ok) setMessage("Could not save the new order. Refresh and try again.");
    }, 500);
  }, [endpoint]);

  const updatePending = (key: string, patch: Partial<Pending>) =>
    setPending((list) => list.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  async function addFiles(files: FileList | File[]) {
    setMessage("");
    const room = max - photosRef.current.length - pending.filter((p) => p.status !== "error").length;
    const list = Array.from(files).filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (list.length === 0) return;
    const accepted = list.slice(0, Math.max(0, room));
    if (accepted.length < list.length) {
      setMessage(`You can add up to ${max} photos. ${list.length - accepted.length} were not added.`);
    }

    const jobs = accepted.map((file) => ({
      file,
      key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }));
    setPending((p) => [
      ...p,
      ...jobs.map((j) => ({ key: j.key, name: j.file.name, progress: 0, status: "waiting" as const })),
    ]);

    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        try {
          updatePending(job.key, { status: "resizing" });
          const { blob, width, height } = await resizePhoto(job.file);
          updatePending(job.key, { status: "uploading" });
          const photo = await uploadBlob(endpoint, blob, width, height, (f) =>
            updatePending(job.key, { progress: f }),
          );
          setPhotos((ps) => [...ps, photo]);
          setPending((ps) => ps.filter((p) => p.key !== job.key));
        } catch (err) {
          const msg =
            err instanceof Error && err.message !== "encode" && err.message !== "canvas" && !(err instanceof DOMException)
              ? err.message
              : "This photo could not be read. Try a JPEG or PNG.";
          updatePending(job.key, { status: "error", error: msg });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  }

  function move(id: string, to: number) {
    setPhotos((ps) => {
      const from = ps.findIndex((p) => p.id === id);
      if (from < 0 || to < 0 || to >= ps.length || from === to) return ps;
      const copy = ps.slice();
      const [item] = copy.splice(from, 1);
      copy.splice(to, 0, item);
      return copy;
    });
    saveOrder();
  }

  async function remove(photo: Photo) {
    if (!window.confirm("Delete this photo?")) return;
    const before = photosRef.current;
    setPhotos((ps) => ps.filter((p) => p.id !== photo.id));
    const res = await fetch(`${endpoint}/${photo.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      setPhotos(before);
      setMessage("Could not delete that photo. Try again.");
    }
  }

  // Pointer based dragging works with mouse, touch and pen.
  function onHandleDown(e: React.PointerEvent, id: string) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragId(id);
  }
  function onHandleMove(e: React.PointerEvent) {
    if (!dragId) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-photo-id]");
    const overId = el?.dataset.photoId;
    if (!overId || overId === dragId) return;
    const to = photosRef.current.findIndex((p) => p.id === overId);
    move(dragId, to);
  }
  function onHandleUp() {
    setDragId(null);
  }
  function onHandleKey(e: React.KeyboardEvent, index: number, id: string) {
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      move(id, index - 1);
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      move(id, index + 1);
    }
  }

  const count = photos.length;
  const status =
    count >= min
      ? `${count} photos. You have enough. You can add up to ${max}.`
      : `${count} of ${min} photos. Add ${min - count} more.`;

  return (
    <div className="pu">
      <div
        className={`pu__drop${dropActive ? " is-active" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDropActive(true);
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDropActive(false);
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
      >
        <p className="pu__drop-title">Add photos of your car</p>
        <p className="pu__drop-hint">
          Photos are resized on your device before upload, and location data is removed.
        </p>
        <button type="button" className="btn" onClick={() => fileInput.current?.click()} disabled={count >= max}>
          Choose photos
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <p className={`pu__status${count >= min ? " is-ok" : ""}`} role="status" aria-live="polite">
        {status}
      </p>
      {message && (
        <p className="pu__message" role="alert">
          {message}
        </p>
      )}

      {pending.length > 0 && (
        <ul className="pu__pending">
          {pending.map((p) => (
            <li key={p.key} className={p.status === "error" ? "is-error" : undefined}>
              <span className="pu__pending-name">{p.name}</span>
              {p.status === "error" ? (
                <>
                  <span className="pu__pending-error">{p.error}</span>
                  <button
                    type="button"
                    className="pu__link"
                    onClick={() => setPending((ps) => ps.filter((x) => x.key !== p.key))}
                  >
                    Dismiss
                  </button>
                </>
              ) : (
                <span className="pu__bar" aria-label={`${p.name} ${Math.round(p.progress * 100)}%`}>
                  <span style={{ width: `${p.status === "uploading" ? Math.max(4, p.progress * 100) : 2}%` }} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {count > 0 && (
        <>
          <p className="pu__help">Drag the handle to reorder. The first photo is the main photo.</p>
          <ol className="pu__grid">
            {photos.map((photo, i) => (
              <li
                key={photo.id}
                data-photo-id={photo.id}
                className={`pu__tile${dragId === photo.id ? " is-dragging" : ""}`}
              >
                <img src={photo.url} alt={`Photo ${i + 1}`} loading="lazy" width={photo.width ?? undefined} height={photo.height ?? undefined} />
                {i === 0 ? <span className="pu__main">Main photo</span> : <span className="pu__num">{i + 1}</span>}
                <div className="pu__tools">
                  <button
                    type="button"
                    className="pu__tool pu__handle"
                    aria-label={`Move photo ${i + 1}. Use arrow keys to move.`}
                    onPointerDown={(e) => onHandleDown(e, photo.id)}
                    onPointerMove={onHandleMove}
                    onPointerUp={onHandleUp}
                    onPointerCancel={onHandleUp}
                    onKeyDown={(e) => onHandleKey(e, i, photo.id)}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><g fill="currentColor"><circle cx="5" cy="3" r="1.2" /><circle cx="9" cy="3" r="1.2" /><circle cx="5" cy="7" r="1.2" /><circle cx="9" cy="7" r="1.2" /><circle cx="5" cy="11" r="1.2" /><circle cx="9" cy="11" r="1.2" /></g></svg>
                  </button>
                  {i > 0 && (
                    <button type="button" className="pu__tool" aria-label={`Make photo ${i + 1} the main photo`} title="Make main photo" onClick={() => move(photo.id, 0)}>
                      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1.8l1.6 3.3 3.6.5-2.6 2.5.6 3.6L7 10l-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
                    </button>
                  )}
                  <button type="button" className="pu__tool" aria-label={`Delete photo ${i + 1}`} title="Delete" onClick={() => remove(photo)}>
                    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}

      <details className="pu__shots">
        <summary>Suggested Shots</summary>
        <ul>
          {SHOT_LIST.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <p>Shoot in daylight, in landscape, with the car clean. Show the flaws too. Buyers trust sellers who do.</p>
      </details>
    </div>
  );
}
