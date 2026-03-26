"use client";

import { useEffect, useRef } from "react";

// 손그림 스타일 SVG 아이콘
const ICONS = [
  // 하트
  `<svg viewBox="0 0 24 22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 20C12 20 2 13 2 7.5C2 4.4 4.4 2 7.5 2C9.3 2 10.8 2.9 12 4.2C13.2 2.9 14.7 2 16.5 2C19.6 2 22 4.4 22 7.5C22 13 12 20 12 20Z" stroke="#1a1a1a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  // 별
  `<svg viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 2L15.8 9.8H24L17.6 14.8L20.4 22.5L13 17.8L5.6 22.5L8.4 14.8L2 9.8H10.2Z" stroke="#1a1a1a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  // 카메라
  `<svg viewBox="0 0 28 22" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="6" width="24" height="14" rx="2" stroke="#1a1a1a" stroke-width="2"/><path d="M8.5 6L11 2.5H17L19.5 6" stroke="#1a1a1a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="14" cy="13" r="4" stroke="#1a1a1a" stroke-width="2"/><circle cx="23" cy="9" r="1" fill="#1a1a1a"/></svg>`,
  // 꽃
  `<svg viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="13" cy="13" r="3" stroke="#1a1a1a" stroke-width="2"/><ellipse cx="13" cy="5.5" rx="2.5" ry="3.2" stroke="#1a1a1a" stroke-width="1.8"/><ellipse cx="13" cy="20.5" rx="2.5" ry="3.2" stroke="#1a1a1a" stroke-width="1.8"/><ellipse cx="5.5" cy="13" rx="3.2" ry="2.5" stroke="#1a1a1a" stroke-width="1.8"/><ellipse cx="20.5" cy="13" rx="3.2" ry="2.5" stroke="#1a1a1a" stroke-width="1.8"/></svg>`,
  // 음표
  `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 18V6L21 4V16" stroke="#1a1a1a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="18" r="3" stroke="#1a1a1a" stroke-width="2"/><circle cx="18" cy="16" r="3" stroke="#1a1a1a" stroke-width="2"/></svg>`,
  // 나뭇잎
  `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 21C6 15 4 8 7 4C10 1 17 3 20 8C23 13 19 19 12 21Z" stroke="#1a1a1a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 21L10 13" stroke="#1a1a1a" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  // 폴라로이드
  `<svg viewBox="0 0 24 28" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="20" height="24" rx="1.5" stroke="#1a1a1a" stroke-width="2"/><rect x="5" y="5" width="14" height="13" stroke="#1a1a1a" stroke-width="1.5"/><line x1="6" y1="21.5" x2="10" y2="21.5" stroke="#1a1a1a" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  // 발바닥
  `<svg viewBox="0 0 50 58" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9.2 40.5c-2.3 5.2 3.2 10.2 9.8 9.6 6.4-.5 12.2-3.2 17.4-5.6 5.2-2.5 7-9.2 4.2-14.4-2.8-5.3-10.6-6-16.4-3.8-5.8 2.1-12.5 8.8-15 14.2z" stroke="#1a1a1a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M15.2 13.8q2.6-5.2 8-4.4 5.4.9 6.8 5.4" stroke="#1a1a1a" stroke-width="1.9" stroke-linecap="round"/><path d="M25.4 8.6q1.4-4.6 6.8-4.2 4.4.6 5.4 5.4" stroke="#1a1a1a" stroke-width="1.8" stroke-linecap="round"/><path d="M34 12q4.2-2.4 8 0 3 2 2.4 6.2" stroke="#1a1a1a" stroke-width="1.7" stroke-linecap="round"/></svg>`,
  // 연필
  `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M17 3L21 7L8 20L3 21L4 16Z" stroke="#1a1a1a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 5L19 9" stroke="#1a1a1a" stroke-width="2" stroke-linecap="round"/><path d="M4 16L8 20" stroke="#1a1a1a" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  // 가위
  `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="6" cy="7" r="3" stroke="#1a1a1a" stroke-width="2"/><circle cx="6" cy="17" r="3" stroke="#1a1a1a" stroke-width="2"/><path d="M20 4.5L7.8 9.5M7.8 14.5L20 19.5" stroke="#1a1a1a" stroke-width="2" stroke-linecap="round"/></svg>`,
  // 구름/말풍선
  `<svg viewBox="0 0 28 22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 16C3 16 2 14.5 2 13C2 11.3 3.2 10 4.8 10C4.3 9.3 4 8.5 4 7.5C4 5.5 5.5 4 7.5 4C8.2 4 8.8 4.2 9.4 4.5C10.2 3 11.7 2 13.5 2C16.5 2 19 4.2 19 7C19 7.2 19 7.4 18.9 7.6C20.1 8.2 21 9.4 21 10.8C21 13 19.2 14.8 17 14.8" stroke="#1a1a1a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 16H22C24 16 25 17 25 18.5C25 20 24 21 22 21H8L5 24L5 21H4C2 21 1 20 1 18.5C1 17 2 16 4 16Z" stroke="#1a1a1a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
];

export function FloatingBackground() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bg = ref.current;
    if (!bg) return;
    bg.innerHTML = "";
    for (let i = 0; i < 22; i++) {
      const wrapper = document.createElement("div");
      wrapper.className = "bg-i";
      const size = Math.round(20 + Math.random() * 22);
      wrapper.innerHTML = ICONS[i % ICONS.length];
      const svg = wrapper.querySelector("svg");
      if (svg) {
        svg.setAttribute("width", String(size));
        svg.setAttribute("height", String(size));
        svg.style.display = "block";
      }
      wrapper.style.cssText = `left:${Math.random() * 100}vw;animation-duration:${11 + Math.random() * 15}s;animation-delay:${-Math.random() * 20}s`;
      bg.appendChild(wrapper);
    }
  }, []);

  return <div className="bg" ref={ref} aria-hidden />;
}
