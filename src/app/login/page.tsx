"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const signIn = async (nextEmail: string, nextPassword: string) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: nextEmail, password: nextPassword }),
      });
      const payload = (await response.json()) as { redirect?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not sign in.");
      router.push(payload.redirect || "/owner");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sign in.");
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <Link href="/" className="mb-6 text-[13px] font-bold text-[#5a966e]">
        ← Back to the release notes
      </Link>
      <div className="rounded-2xl border border-[#e3e8df] bg-white p-6">
        <span className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#5a966e]">Demo workspace</span>
        <h1 className="mt-2 text-2xl font-black tracking-tight">Karibu back</h1>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#56655a]">
          Tap a demo login to jump straight in, or type the details below.
        </p>

        <div className="mt-5 grid gap-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => signIn("founder@demo.stoyangu.test", "demo1234")}
            className="flex min-h-14 items-center gap-3 rounded-xl border border-[#d9dfda] bg-[#f7faf6] px-4 text-left transition hover:border-[#5a966e] disabled:opacity-60"
          >
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[#101f30] text-[13px] font-extrabold text-white">F</span>
            <span className="min-w-0">
              <strong className="block text-[14px] font-extrabold">Demo founder login</strong>
              <small className="block text-[12px] text-[#77857a]">All stores, applications, notification centre</small>
            </span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => signIn("owner@demo.stoyangu.test", "demo1234")}
            className="flex min-h-14 items-center gap-3 rounded-xl border border-[#d9dfda] bg-[#f7faf6] px-4 text-left transition hover:border-[#5a966e] disabled:opacity-60"
          >
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[#5a966e] text-[13px] font-extrabold text-white">S</span>
            <span className="min-w-0">
              <strong className="block text-[14px] font-extrabold">Demo store owner login</strong>
              <small className="block text-[12px] text-[#77857a]">Stevo Sportswear · products, chat, composer</small>
            </span>
          </button>
        </div>

        <div className="my-5 text-center text-[11px] font-bold uppercase tracking-widest text-[#a6b0a6]">or</div>

        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void signIn(email, password);
          }}
        >
          <label className="grid gap-1.5 text-[12px] font-bold text-[#44604c]">
            Email
            <input
              className="min-h-11 rounded-xl border border-[#d9dfda] px-3 text-[14px] font-normal outline-none focus:border-[#5a966e]"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="owner@demo.stoyangu.test"
              autoComplete="username"
            />
          </label>
          <label className="grid gap-1.5 text-[12px] font-bold text-[#44604c]">
            Password
            <input
              type="password"
              className="min-h-11 rounded-xl border border-[#d9dfda] px-3 text-[14px] font-normal outline-none focus:border-[#5a966e]"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="demo1234"
              autoComplete="current-password"
            />
          </label>
          {error && <div className="rounded-lg bg-[#fdecea] px-3 py-2 text-[13px] font-semibold text-[#b4443a]">{error}</div>}
          <button
            disabled={busy}
            className="min-h-12 rounded-xl bg-[#5a966e] text-[15px] font-extrabold text-white transition hover:bg-[#477c59] disabled:opacity-60"
          >
            {busy ? "Checking…" : "Login securely"}
          </button>
        </form>
      </div>
      <p className="mt-4 text-center text-[12px] leading-relaxed text-[#8a9589]">
        These demo accounts exist only in this preview. They are not in the ZIP you drop into your repo.
      </p>
    </main>
  );
}
