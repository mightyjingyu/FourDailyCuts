"use client";

import { forwardRef } from "react";

export type FrameTheme =
  | "green"
  | "yellow"
  | "purple"
  | "red"
  | "basicBlack"
  | "basicWhite";

const THEME_CLASS: Record<FrameTheme, string> = {
  green: "t1",
  yellow: "t2",
  purple: "t3",
  red: "t4",
  basicBlack: "t5",
  basicWhite: "t6",
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

export const PhotoFrame = forwardRef<HTMLDivElement, PhotoFrameProps>(function PhotoFrame(
  { theme, photos, slotReadonly = false, staticForCapture = false, previewMode = false },
  ref
) {
  const isBasic = theme === "basicBlack" || theme === "basicWhite";
  const isIllustrated = !isBasic;
  const t = THEME_CLASS[theme];
  const m = THEME_META[theme];
  const charSrc = THEME_CHARACTER_SRC[theme];
  const p = [...photos];
  while (p.length < 4) p.push(null);
  const [p0, p1, p2, p3] = p.slice(0, 4);

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
              <span className="paw p1">🐾</span>
              <span className="paw p2">🐾</span>
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
