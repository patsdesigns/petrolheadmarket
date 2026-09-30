import { useEffect, useRef, useState } from "react";

interface Msg {
  id: string;
  mine: boolean;
  body: string;
  createdAt: string;
  read: boolean;
  hidden?: boolean;
}

interface Props {
  endpoint: string;
  initial: Msg[];
  otherName: string;
  canReply: boolean;
  maxLength: number;
}

const POLL_MS = 15000;

function time(iso: string) {
  // A fixed zone (like the inbox list and admin pages), so the server render
  // and the browser produce the same text and hydration matches.
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
}

export default function MessageThread({ endpoint, initial, otherName, canReply, maxLength }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>(initial);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [msgs.length]);

  // Check for new messages while the page is open and visible.
  useEffect(() => {
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const res = await fetch(endpoint, { headers: { accept: "application/json" } }).catch(() => null);
      if (res?.ok) setMsgs(((await res.json()) as { messages: Msg[] }).messages);
    };
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [endpoint]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    }).catch(() => null);
    const data = (res ? await res.json().catch(() => null) : null) as { messages: Msg[]; error?: string } | null;
    setSending(false);
    if (!res?.ok) {
      setError(data?.error ?? "Could not send. Check your connection and try again.");
      return;
    }
    setDraft("");
    if (data) setMsgs(data.messages);
  }

  return (
    <div className="mt">
      <ol className="mt__list" aria-live="polite">
        {msgs.map((m) => (
          <li key={m.id} className={m.mine ? "mt__msg is-mine" : "mt__msg"}>
            <span className="mt__who">
              {m.mine ? "You" : otherName}
              {m.hidden ? " · Hidden by an admin" : ""}
            </span>
            <p className="mt__body">{m.body}</p>
            <span className="mt__time">
              {time(m.createdAt)}
              {m.mine && m.read ? " · Read" : ""}
            </span>
          </li>
        ))}
      </ol>
      <div ref={bottom} />
      {canReply && (
        <form className="mt__form" onSubmit={send}>
          <label htmlFor="mt-body" className="mt__label">
            Reply to {otherName}
          </label>
          <textarea
            id="mt-body"
            rows={3}
            maxLength={maxLength}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(e);
            }}
          />
          {error && (
            <p className="mt__error" role="alert">
              {error}
            </p>
          )}
          <button className="btn" type="submit" disabled={sending || !draft.trim()}>
            {sending ? "Sending…" : "Send message"}
          </button>
        </form>
      )}
    </div>
  );
}
