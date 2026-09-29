"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type DemoProduct = {
  id: number;
  name: string;
  price: string;
  imageUrl: string;
  images: string[];
  videoUrl: string;
  colors: string[];
  sizes: string[];
  viewsTotal: number;
  viewsToday: number;
  ordersTotal: number;
  ordersToday: number;
};

export type DemoMessage = { id: number; threadId: number; direction: string; body: string; attachmentName: string; createdAt: string };
export type DemoThread = {
  id: number;
  platform: string;
  kind: string;
  senderName: string;
  senderHandle: string;
  sourceTitle: string;
  lastAt: string;
  messages: DemoMessage[];
};

export type DemoStore = { id: number; name: string; slug: string; logoUrl: string; visitorTotal: number; visitorToday: number; ordersTotal: number; ordersToday: number; customers: number };

const money = (value: string | number) =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(Number(value) || 0);

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", hour12: false });

const PLATFORM_DOT: Record<string, string> = {
  whatsapp: "bg-[#25d366]",
  instagram: "bg-[#e1306c]",
  tiktok: "bg-[#010101]",
  facebook: "bg-[#1877f2]",
  storefront: "bg-[#5a966e]",
};

export default function OwnerWorkspace({ store, products, threads }: { store: DemoStore; products: DemoProduct[]; threads: DemoThread[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<"products" | "customers">("products");
  const [viewing, setViewing] = useState<DemoProduct | null>(null);
  const [openThread, setOpenThread] = useState<DemoThread | null>(null);

  // FIX 3 — one shared back-stack. The newest open layer closes first, and the
  // phone's Back gesture never falls through and closes the whole app.
  useEffect(() => {
    const layers: Array<() => void> = [];
    if (viewing) layers.push(() => setViewing(null));
    if (openThread) layers.push(() => setOpenThread(null));
    if (!layers.length) return;
    window.history.pushState({ woyoyoLayer: true }, "", window.location.href);
    const onPop = () => layers[layers.length - 1]();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [viewing, openThread]);

  const signOut = async () => {
    await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout" }) });
    router.push("/login");
    router.refresh();
  };

  return (
    <div className="mx-auto min-h-screen w-full max-w-[460px] bg-white pb-24 shadow-[0_0_60px_rgba(16,31,48,.08)]">
      <header className="border-b border-[#eceee9] px-4 pb-4 pt-5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#5a966e]">StoYangu</span>
          <button onClick={signOut} className="rounded-full border border-[#dfe4dc] px-3 py-1.5 text-[11px] font-extrabold text-[#56655a]">
            Sign out
          </button>
        </div>
        <div className="mt-3 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={store.logoUrl} alt={`${store.name} logo`} className="h-14 w-14 rounded-full object-cover" />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-black tracking-tight">{store.name}</h1>
            <p className="truncate text-[12px] text-[#7d8a80]">{store.slug}.stoyangu.com</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            [store.customers, "customers", store.ordersToday],
            [store.visitorTotal, "visitors", store.visitorToday],
            [store.ordersTotal, "orders", store.ordersToday],
          ].map(([total, label, today]) => (
            <div key={String(label)} className="rounded-xl bg-[#f5f8f3] py-2">
              <strong className="block text-[16px] font-black">{Number(total).toLocaleString()}</strong>
              <span className="text-[11px] text-[#7d8a80]">{String(label)}</span>
              <small className="block text-[10px] font-bold text-[#5a966e]">+{Number(today)} today</small>
            </div>
          ))}
        </div>
        {/* FIX 4 — the "Day 12/30 · ends 17 Oct" line used to sit right here. Removed. */}
      </header>

      {tab === "products" ? (
        <ProductsPage products={products} onOpen={setViewing} />
      ) : (
        <CustomersPage threads={threads} openThread={openThread} setOpenThread={setOpenThread} />
      )}

      <nav className="fixed bottom-0 left-1/2 z-30 w-full max-w-[460px] -translate-x-1/2 border-t border-[#eceee9] bg-white/95 px-4 py-2 backdrop-blur">
        <div className="flex items-center justify-around">
          <button onClick={() => setTab("products")} className={`flex flex-col items-center gap-0.5 px-4 py-1 text-[11px] font-extrabold ${tab === "products" ? "text-[#248857]" : "text-[#93a096]"}`}>
            <span className="text-lg">🛍️</span> My Products
          </button>
          <span className="grid h-12 w-12 place-items-center rounded-full bg-[#5a966e] text-2xl text-white shadow-[0_8px_20px_rgba(66,122,88,.3)]">+</span>
          <button onClick={() => setTab("customers")} className={`relative flex flex-col items-center gap-0.5 px-4 py-1 text-[11px] font-extrabold ${tab === "customers" ? "text-[#248857]" : "text-[#93a096]"}`}>
            <span className="text-lg">💬</span> My Customers
          </button>
        </div>
      </nav>

      {viewing && <ProductDetailSheet product={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* FIX 1 — only the main photo on the list; everything else on tap    */
/* ---------------------------------------------------------------- */
function ProductsPage({ products, onOpen }: { products: DemoProduct[]; onOpen: (product: DemoProduct) => void }) {
  return (
    <section className="px-4 pt-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[17px] font-black tracking-tight">My Products</h2>
        <span className="rounded-full bg-[#eef3ec] px-2 py-0.5 text-[11px] font-extrabold text-[#44604c]">{products.length}</span>
      </div>
      <p className="mb-4 rounded-xl bg-[#f3f8f2] px-3 py-2 text-[12px] leading-relaxed text-[#56655a]">
        <strong>Fix 1:</strong> cover photo only — no photo strip, no inline video preview. Tap any product for the full gallery,
        the video and the details.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {products.map((product) => {
          const mediaCount = Math.max(product.images.length, 1) + (product.videoUrl ? 1 : 0);
          return (
            <article key={product.id} className="overflow-hidden rounded-2xl border border-[#eceee9]">
              <button type="button" onClick={() => onOpen(product)} className="block w-full text-left">
                <div className="relative aspect-square w-full overflow-hidden bg-[#eef1ec]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" loading="lazy" />
                  {mediaCount > 1 && (
                    <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-[#101f30]/75 px-2 py-1 text-[10px] font-extrabold text-white backdrop-blur-sm">
                      {product.videoUrl ? "▶" : "🖼"} {mediaCount}
                    </span>
                  )}
                </div>
                <div className="px-3 py-2.5">
                  <h3 className="truncate text-[13.5px] font-extrabold">{product.name}</h3>
                  <strong className="text-[13px] font-black text-[#248857]">{money(product.price)}</strong>
                </div>
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ProductDetailSheet({ product, onClose }: { product: DemoProduct; onClose: () => void }) {
  const slides = [
    ...(product.images.length ? product.images : [product.imageUrl]).map((url) => ({ kind: "image" as const, url })),
    ...(product.videoUrl ? [{ kind: "video" as const, url: product.videoUrl }] : []),
  ];
  const [active, setActive] = useState(0);
  const current = slides[Math.min(active, slides.length - 1)];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#101f30]/55 p-0 sm:items-center sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="max-h-[92dvh] w-full max-w-[460px] overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#5a966e]">Product details</span>
            <h2 className="truncate text-lg font-black tracking-tight">{product.name}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#e2e7e0] text-lg">
            ×
          </button>
        </div>

        <div className="grid aspect-[4/5] w-full place-items-center overflow-hidden rounded-2xl bg-[#101f30]">
          {current?.kind === "video" ? (
            <video src={current.url} poster={product.imageUrl} controls playsInline preload="metadata" className="h-full w-full object-contain" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current?.url || product.imageUrl} alt={product.name} className="h-full w-full object-contain" />
          )}
        </div>

        {slides.length > 1 && (
          <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1">
            {slides.map((slide, index) => (
              <button
                key={`${slide.url}-${index}`}
                onClick={() => setActive(index)}
                className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 bg-[#eef1ec] ${index === active ? "border-[#248857]" : "border-transparent"}`}
              >
                {slide.kind === "video" ? (
                  <>
                    <video src={slide.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                    <span className="absolute inset-0 grid place-items-center bg-[#101f30]/35 text-white">▶</span>
                  </>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={slide.url} alt="" className="h-full w-full object-cover" />
                )}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4">
          <h3 className="text-[17px] font-black tracking-tight">{product.name}</h3>
          <strong className="text-[16px] font-black text-[#248857]">{money(product.price)}</strong>
          <p className="text-[12px] text-[#7d8a80]">
            {product.images.length} photo{product.images.length === 1 ? "" : "s"}
            {product.videoUrl ? " · 1 video" : ""}
          </p>
        </div>

        {(product.colors.length > 0 || product.sizes.length > 0) && (
          <div className="mt-3 grid gap-2">
            {[product.colors, product.sizes].map((group, index) =>
              group.length ? (
                <div key={index} className="flex flex-wrap gap-1.5">
                  {group.map((item) => (
                    <span key={item} className="rounded-full bg-[#eef3ec] px-2.5 py-1 text-[12px] font-bold text-[#3c5a45]">
                      {item}
                    </span>
                  ))}
                </div>
              ) : null,
            )}
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <div className="rounded-xl bg-[#f5f7f3] px-3 py-2.5">
            <strong className="block text-[16px] font-black">{product.viewsTotal}</strong>
            <small className="text-[11px] text-[#77857a]">views (+{product.viewsToday} today)</small>
          </div>
          <div className="rounded-xl bg-[#f5f7f3] px-3 py-2.5">
            <strong className="block text-[16px] font-black">{product.ordersTotal}</strong>
            <small className="text-[11px] text-[#77857a]">orders (+{product.ordersToday} today)</small>
          </div>
        </div>

        <div className="mt-4 flex gap-2.5">
          <button className="min-h-11 flex-1 rounded-xl border border-[#dbe1d8] text-[13px] font-extrabold">✎ Edit product</button>
          <button className="min-h-11 flex-1 rounded-xl border border-[#f0d3d0] text-[13px] font-extrabold text-[#b4443a]">🗑 Delete</button>
        </div>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* FIX 2 — WhatsApp-style one-row composer                            */
/* ---------------------------------------------------------------- */
function CustomersPage({
  threads,
  openThread,
  setOpenThread,
}: {
  threads: DemoThread[];
  openThread: DemoThread | null;
  setOpenThread: (thread: DemoThread | null) => void;
}) {
  if (openThread) return <ChatView thread={openThread} onBack={() => setOpenThread(null)} />;
  return (
    <section className="px-4 pt-4">
      <h2 className="mb-3 text-[17px] font-black tracking-tight">My Customers</h2>
      <p className="mb-4 rounded-xl bg-[#f3f8f2] px-3 py-2 text-[12px] leading-relaxed text-[#56655a]">
        <strong>Fix 2 + 3:</strong> open a chat — the message box, camera and send button now sit on one row, and your phone&apos;s
        Back gesture closes the chat instead of the whole app.
      </p>
      <div className="grid gap-1">
        {threads.map((thread) => {
          const last = thread.messages[thread.messages.length - 1];
          return (
            <button key={thread.id} onClick={() => setOpenThread(thread)} className="flex items-start gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-[#f5f8f3]">
              <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#e6ede4] text-[15px] font-black text-[#3c5a45]">
                {thread.senderName[0]?.toUpperCase()}
                <span className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white ${PLATFORM_DOT[thread.platform] || "bg-[#5a966e]"}`} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <strong className="truncate text-[14px] font-extrabold">{thread.senderName}</strong>
                  <small className="shrink-0 text-[11px] text-[#93a096]">{time(thread.lastAt)}</small>
                </span>
                <span className="block text-[11px] font-bold uppercase tracking-wide text-[#93a096]">
                  {thread.platform === "storefront" ? "Store order" : thread.kind === "dm" ? "DM" : "Comment"}
                </span>
                <span className="block truncate text-[13px] text-[#65736a]">{last?.body}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ChatView({ thread, onBack }: { thread: DemoThread; onBack: () => void }) {
  const [list, setList] = useState<DemoMessage[]>(thread.messages);
  const [reply, setReply] = useState("");
  const [attachment, setAttachment] = useState<string>("");
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [list.length]);

  const send = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if ((!reply.trim() && !attachment) || sending) return;
    setSending(true);
    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: thread.id, body: reply.trim(), attachmentName: attachment }),
      });
      const payload = (await response.json()) as { message?: DemoMessage };
      if (payload.message) setList((current) => [...current, payload.message as DemoMessage]);
      setReply("");
      setAttachment("");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="flex h-[calc(100dvh-224px)] flex-col">
      <div className="flex items-center gap-3 border-b border-[#eceee9] px-3 py-2.5">
        <button onClick={onBack} aria-label="Back to customers" className="grid h-9 w-9 place-items-center rounded-full text-lg text-[#44604c]">
          ←
        </button>
        <span className="relative grid h-9 w-9 place-items-center rounded-full bg-[#e6ede4] text-[13px] font-black text-[#3c5a45]">
          {thread.senderName[0]?.toUpperCase()}
          <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${PLATFORM_DOT[thread.platform] || "bg-[#5a966e]"}`} />
        </span>
        <div className="min-w-0">
          <strong className="block truncate text-[14px] font-extrabold">{thread.senderName}</strong>
          <small className="block truncate text-[11px] text-[#93a096]">{thread.senderHandle || thread.platform}</small>
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto bg-[#f6f8f4] px-3 py-3">
        {list.map((message) => (
          <div
            key={message.id}
            className={`max-w-[80%] rounded-2xl px-3 py-2 text-[13.5px] leading-relaxed ${
              message.direction === "out" ? "ml-auto bg-[#d9f2e2] text-[#183a28]" : "bg-white text-[#24382a]"
            }`}
          >
            <p className="whitespace-pre-wrap break-words">{message.body}</p>
            {message.attachmentName && <p className="mt-1 text-[11px] font-bold text-[#44604c]">📎 {message.attachmentName}</p>}
            <small className="mt-0.5 block text-right text-[10px] text-[#8a9589]">{time(message.createdAt)}</small>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      {/* FIX 2: attachment chip above, then message field + camera + send on ONE row. */}
      <form onSubmit={send} className="border-t border-[#eceee9] bg-white px-2.5 py-2">
        {attachment && (
          <span className="mb-2 inline-flex max-w-full items-center gap-2 truncate rounded-lg bg-[#e9f5ec] px-2.5 py-1.5 text-[12px] font-bold text-[#2c5a3e]">
            {attachment}
            <button type="button" onClick={() => setAttachment("")} aria-label="Remove attachment">
              ×
            </button>
          </span>
        )}
        <div className="flex w-full min-w-0 items-end gap-2">
          <div className="flex min-w-0 flex-1 items-end gap-0.5 rounded-3xl border border-[#e2e7e0] bg-[#f2f4f1] py-0.5 pl-2.5 pr-1">
            <textarea
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder="Message"
              className="max-h-[120px] min-h-[40px] w-full flex-1 resize-none bg-transparent py-2.5 text-[14px] outline-none"
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              aria-label="Take a photo or video"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#5f7067]"
            >
              📷
            </button>
          </div>
          <button
            disabled={sending || (!reply.trim() && !attachment)}
            aria-label="Send message"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#248857] text-white shadow-[0_6px_16px_rgba(36,136,87,.28)] disabled:opacity-45 disabled:shadow-none"
          >
            ➤
          </button>
        </div>
        <input
          ref={fileInput}
          hidden
          type="file"
          accept="image/*,video/*"
          onChange={(event) => {
            setAttachment(event.target.files?.[0]?.name || "");
            event.target.value = "";
          }}
        />
      </form>
    </section>
  );
}
