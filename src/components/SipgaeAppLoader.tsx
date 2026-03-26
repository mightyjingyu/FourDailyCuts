"use client";

import dynamic from "next/dynamic";

const SipgaeApp = dynamic(() => import("@/components/SipgaeApp"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f0eaf8",
        color: "#6a5888",
        fontSize: "0.95rem",
      }}
    >
      로딩 중…
    </div>
  ),
});

export function SipgaeAppLoader() {
  return <SipgaeApp />;
}
