"use client";

import { useEffect, useRef } from "react";

const POOL = ["⭐", "🌸", "💜", "🐾", "✨", "💛", "🩷", "📚", "💤", "🌿"];

export function FloatingBackground() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bg = ref.current;
    if (!bg) return;
    bg.innerHTML = "";
    for (let i = 0; i < 22; i++) {
      const e = document.createElement("span");
      e.className = "bg-i";
      e.textContent = POOL[i % POOL.length];
      e.style.cssText = `left:${Math.random() * 100}vw;font-size:${0.8 + Math.random() * 1.4}rem;animation-duration:${11 + Math.random() * 15}s;animation-delay:${-Math.random() * 20}s`;
      bg.appendChild(e);
    }
  }, []);

  return <div className="bg" ref={ref} aria-hidden />;
}
