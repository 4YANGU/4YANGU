"use client";

import { useRouter } from "next/navigation";

export default function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "logout" }),
        });
        router.push("/login");
        router.refresh();
      }}
      className="rounded-xl border border-[#dfe4dc] bg-white px-4 py-2 text-[13px] font-extrabold text-[#56655a]"
    >
      Sign out
    </button>
  );
}
