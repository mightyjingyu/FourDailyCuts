"use client";

import { forwardRef } from "react";
import dropoutEditionFrame from "../../자퇴할개프레임.png";
import homeGoEditionFrame from "../../집에갈개프레임.png";

export type FrameTheme =
  | "green"
  | "yellow"
  | "purple"
  | "red"
  | "basicBlack"
  | "basicWhite"
  | "dailyEditionDropout"
  | "dailyEditionHomeGo";

const THEME_CLASS: Record<FrameTheme, string> = {
  green: "t1",
  yellow: "t2",
  purple: "t3",
  red: "t4",
  basicBlack: "t5",
  basicWhite: "t6",
  dailyEditionDropout: "t8",
  dailyEditionHomeGo: "t8",
};

type PhotoFrameProps = {
  theme: FrameTheme;
  photos: (string | null)[];
  /** 웹캠 플로우: 슬롯 클릭 비활성, 호버 최소화 */
  slotReadonly?: boolean;
  /** html2canvas 직전 애니메이션 정지 */
  staticForCapture?: boolean;
  /** 선택 화면 미리보기: 빈 슬롯 UI/호버 제거 */
  previewMode?: boolean;
};

function DogCharacter({
  src,
  width,
  height,
  offsetX = 0,
}: {
  src: string;
  width: number;
  height: number;
  offsetX?: number;
}) {
  return (
    <div className="char-wrap" style={{ position: "relative", width, height }}>
      <img
        src={src}
        alt=""
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: "100%",
          height: "100%",
          objectFit: "contain",
          objectPosition: "center",
          transform: `translate(calc(-50% + ${offsetX}px), -50%)`,
          transformOrigin: "center center",
          userSelect: "none",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

function GreenCharacter() {
  return <DogCharacter src="/sipgae-dog-cutout.png" width={138} height={98} offsetX={-5} />;
}

function YellowCharacter() {
  return <DogCharacter src="/sipgae-dog-yellow.png" width={138} height={98} />;
}

function PurpleCharacter() {
  return <DogCharacter src="/sipgae-dog-purple.png" width={138} height={98} />;
}

function RedCharacter() {
  return <DogCharacter src="/sipgae-dog-red.png" width={138} height={98} />;
}

function EmptyCharacter() {
  return <div style={{ width: 138, height: 98 }} />;
}

function HandDrawnPawLeft({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 50 58" fill="none" aria-hidden>
      <path
        d="M9.2 40.5c-2.3 5.2 3.2 10.2 9.8 9.6 6.4-.5 12.2-3.2 17.4-5.6 5.2-2.5 7-9.2 4.2-14.4-2.8-5.3-10.6-6-16.4-3.8-5.8 2.1-12.5 8.8-15 14.2z"
        stroke="#1a1a1a"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="rgba(26,26,26,0.04)"
      />
      <path d="M15.2 13.8q2.6-5.2 8-4.4 5.4.9 6.8 5.4" stroke="#1a1a1a" strokeWidth="1.85" strokeLinecap="round" />
      <path d="M25.4 8.6q1.4-4.6 6.8-4.2 4.4.6 5.4 5.4" stroke="#1a1a1a" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M33.6 11.8q4.2-2.4 8 0 3 2 2.4 6.2" stroke="#1a1a1a" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M36.4 21q3.8 2.2 4 7-1.4 3.8-5.2 4.4" stroke="#1a1a1a" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function HandDrawnPawRight({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 50 58" fill="none" aria-hidden>
      <path
        d="M10.8 42.4c-1 5.8 4.8 9.6 11.2 8.4 6.6-1.2 13-5 17.6-8.2 4.6-3.2 5.4-10.6 1-15.2-4.4-4.6-12-2.6-18 1.4-6 4-11.4 9.8-12 13.6z"
        stroke="#1a1a1a"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="rgba(26,26,26,0.035)"
      />
      <path d="M14.6 15q3.4-4.4 8.6-3.2 5 1.2 5.8 6" stroke="#1a1a1a" strokeWidth="1.82" strokeLinecap="round" />
      <path d="M24 10.2q2-4 7.4-3.6 4.8.4 6 5" stroke="#1a1a1a" strokeWidth="1.78" strokeLinecap="round" />
      <path d="M32 12.6q4.4-1.8 8.2.8 2.8 1.8 2 6.4" stroke="#1a1a1a" strokeWidth="1.72" strokeLinecap="round" />
      <path d="M35.4 22q3.2 2.8 3.4 7.2-1 3.6-4.8 4" stroke="#1a1a1a" strokeWidth="1.68" strokeLinecap="round" />
    </svg>
  );
}

const THEME_CHARACTER_SRC: Partial<Record<FrameTheme, string>> = {
  green: "/sipgae-dog-cutout.png",
  yellow: "/sipgae-dog-yellow.png",
  purple: "/sipgae-dog-purple.png",
  red: "/sipgae-dog-red.png",
};

const THEME_META: Record<
  FrameTheme,
  {
    tag: string;
    ftMain: string;
    ftSub: string;
    slotIco: string;
    divIcos: [string, string, string];
  }
> = {
  green: {
    tag: "수업 작작해요",
    ftMain: "집에 가고 싶개",
    ftSub: "🐾 HOME SWEET HOME 🐾",
    slotIco: "📷",
    divIcos: ["📚", "🐾", "💤"],
  },
  yellow: {
    tag: "수업 멈춰 멈춰 멈춰",
    ftMain: "공부 멈추고 싶개",
    ftSub: "⚠️ STUDY STOP ⚠️",
    slotIco: "📷",
    divIcos: ["⛔", "🐾", "⚠️"],
  },
  purple: {
    tag: "애들아..공부하자매",
    ftMain: "공부 던지고 싶개",
    ftSub: "🫠 NO STUDY ZONE 🫠",
    slotIco: "📷",
    divIcos: ["😵", "🐾", "🫠"],
  },
  red: {
    tag: "과제 내지마라 진짜",
    ftMain: "자퇴하고 싶개",
    ftSub: "🔥 NO MORE HOMEWORK 🔥",
    slotIco: "📷",
    divIcos: ["🔥", "🐾", "💢"],
  },
  basicBlack: {
    tag: "PHOTO FRAME",
    ftMain: "기본 프레임 - 검정",
    ftSub: "BASIC BLACK",
    slotIco: "📷",
    divIcos: ["•", "•", "•"],
  },
  basicWhite: {
    tag: "PHOTO FRAME",
    ftMain: "기본 프레임 - 흰색",
    ftSub: "BASIC WHITE",
    slotIco: "📷",
    divIcos: ["•", "•", "•"],
  },
  dailyEditionDropout: {
    tag: "일상네컷 에디션",
    ftMain: "일상네컷 에디션",
    ftSub: "DAILY EDITION",
    slotIco: "📷",
    divIcos: ["•", "•", "•"],
  },
  dailyEditionHomeGo: {
    tag: "일상네컷 에디션",
    ftMain: "일상네컷 에디션",
    ftSub: "DAILY EDITION",
    slotIco: "📷",
    divIcos: ["•", "•", "•"],
  },
};

function SlotCell({
  src,
  ico,
  lbl,
  readonly,
  hideEmptyUi = false,
}: {
  src: string | null;
  ico: string;
  lbl: string;
  readonly?: boolean;
  hideEmptyUi?: boolean;
}) {
  const filled = Boolean(src);
  return (
    <div className={`slot photo-slot${readonly ? " slotReadonly" : ""}`}>
      {filled ? <img alt="" src={src!} /> : null}
      {!filled && !hideEmptyUi && <span className="slot-ico">{ico}</span>}
      {!filled && !hideEmptyUi && <span className="slot-lbl">{lbl}</span>}
    </div>
  );
}

function EditionSlot({
  src,
  readonly,
  hideEmptyUi = false,
  xPct,
  yPct,
  wPct,
  hPct,
}: {
  src: string | null;
  readonly?: boolean;
  hideEmptyUi?: boolean;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}) {
  const filled = Boolean(src);
  return (
    <div
      className={`edition-slot${readonly ? " slotReadonly" : ""}`}
      style={{
        left: `${xPct}%`,
        top: `${yPct}%`,
        width: `${wPct}%`,
        height: `${hPct}%`,
      }}
    >
      {filled ? <img alt="" src={src!} /> : null}
      {!filled && !hideEmptyUi ? <span className="edition-slot-placeholder" /> : null}
    </div>
  );
}

export const PhotoFrame = forwardRef<HTMLDivElement, PhotoFrameProps>(function PhotoFrame(
  { theme, photos, slotReadonly = false, staticForCapture = false, previewMode = false },
  ref
) {
  const isBasic = theme === "basicBlack" || theme === "basicWhite";
  const isDailyEdition = theme === "dailyEditionDropout" || theme === "dailyEditionHomeGo";
  const isIllustrated = !isBasic;
  const t = THEME_CLASS[theme];
  const m = THEME_META[theme];
  const charSrc = THEME_CHARACTER_SRC[theme];
  const p = [...photos];
  while (p.length < 4) p.push(null);
  const [p0, p1, p2, p3] = p.slice(0, 4);

  if (isDailyEdition) {
    const editionBgSrc =
      theme === "dailyEditionDropout" ? dropoutEditionFrame.src : homeGoEditionFrame.src;
    return (
      <div
        ref={ref}
        className={`card ${t}${staticForCapture ? " captureStatic" : ""}${previewMode ? " previewCard" : ""}`}
      >
        <div className="editionCanvas">
          <img className="editionFrameBg" src={editionBgSrc} alt="" />
          {/* Slot coords are mapped from 1000x3000 to % */}
          <EditionSlot
            src={p0}
            readonly={slotReadonly}
            hideEmptyUi={previewMode}
            xPct={3}
            yPct={1.633}
            wPct={94}
            hPct={19.333}
          />
          <EditionSlot
            src={p1}
            readonly={slotReadonly}
            hideEmptyUi={previewMode}
            xPct={3}
            yPct={21.633}
            wPct={94}
            hPct={19.333}
          />
          <EditionSlot
            src={p2}
            readonly={slotReadonly}
            hideEmptyUi={previewMode}
            xPct={3}
            yPct={41.633}
            wPct={94}
            hPct={19.333}
          />
          <EditionSlot
            src={p3}
            readonly={slotReadonly}
            hideEmptyUi={previewMode}
            xPct={3}
            yPct={61.633}
            wPct={94}
            hPct={19.333}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={`card ${t}${isIllustrated ? " storyMode" : ""}${isBasic ? " basicMode" : ""}${staticForCapture ? " captureStatic" : ""}${previewMode ? " previewCard" : ""}`}
    >
      <div className="grid">
        <SlotCell src={p0} ico={m.slotIco} lbl="웹캠 촬영" readonly={slotReadonly} hideEmptyUi={previewMode} />
        <SlotCell src={p1} ico={m.slotIco} lbl="웹캠 촬영" readonly={slotReadonly} hideEmptyUi={previewMode} />
        <SlotCell src={p2} ico={m.slotIco} lbl="웹캠 촬영" readonly={slotReadonly} hideEmptyUi={previewMode} />
        <SlotCell src={p3} ico={m.slotIco} lbl="웹캠 촬영" readonly={slotReadonly} hideEmptyUi={previewMode} />
        {isBasic && (
          <>
            <div className="basicBrandTop">일상네컷</div>
          </>
        )}
        {isIllustrated && (
          <>
            <div className={`storyBurst storySpeech speech-${theme}`}>{m.tag}</div>
            {charSrc && (
              <div className="slotChars" aria-hidden>
                <img className="slotChar slotChar1" src={charSrc} alt="" />
                <img className="slotChar slotChar2" src={charSrc} alt="" />
                <img className="bigBottomChar" src={charSrc} alt="" />
              </div>
            )}
            <div className="storyBottomTitle">
              {m.ftMain.split("").map((ch, idx) => (
                <span
                  key={`${ch}-${idx}`}
                  className={`rainbowChar${ch === "개" ? " gaChar" : ""}${theme === "red" && idx === 1 ? " swapToBlue" : ""}${theme === "red" && idx === 2 ? " swapToPurple" : ""}${theme === "red" && idx === 3 ? " swapToGreen" : ""}`}
                >
                  {ch === " " ? "\u00A0" : ch}
                </span>
              ))}
            </div>
            <div className="storyDecor" aria-hidden>
              <span className="d d1">⭐</span>
              <span className="d d2">💖</span>
              <span className="d d3">{m.divIcos[0]}</span>
              <span className="d d4">✨</span>
              <span className="d d5">{m.divIcos[2]}</span>
              <span className="d d6">🌟</span>
              <span className="d d7">🎀</span>
              <span className="d d8">🫧</span>
              <span className="d d9">🍀</span>
              <span className="d d10">💫</span>
            </div>
            <div className="storyTape" aria-hidden>
              <span className="tape tp1" />
              <span className="tape tp2" />
              <span className="tape tp3" />
              <span className="tape tp4" />
            </div>
            <div className="storyPaws" aria-hidden>
              <HandDrawnPawLeft className="pawSvg p1" />
              <HandDrawnPawRight className="pawSvg p2" />
            </div>
          </>
        )}
      </div>
      <div className="frame-bottom">
        <div className="hd hdBottom">
          {theme === "green" && <GreenCharacter />}
          {theme === "yellow" && <YellowCharacter />}
          {theme === "purple" && <PurpleCharacter />}
          {theme === "red" && <RedCharacter />}
          {theme === "basicBlack" && <EmptyCharacter />}
          {theme === "basicWhite" && <EmptyCharacter />}
        </div>
        <div className="ft">
          <div className="ft-main">{m.ftMain}</div>
        </div>
      </div>
    </div>
  );
});
