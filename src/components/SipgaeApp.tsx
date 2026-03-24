"use client";

import html2canvas from "html2canvas";
import { useCallback, useEffect, useRef, useState } from "react";
import { FloatingBackground } from "./FloatingBackground";
import { PhotoFrame, type FrameTheme } from "./PhotoFrame";

type Step = "home" | "select" | "loading" | "shoot" | "done";

const EMPTY: (string | null)[] = [null, null, null, null];
// 미백: 밝기↑ 채도↓ 살짝 소프트닝
const CAMERA_FILTER = "brightness(1.13) contrast(1.04) saturate(0.78) blur(0.28px)";

// ── 뷰티 보정 상수 (모든 값은 프레임 크기 대비 비율) ──────────────────────
// 얼굴 갸름 (가로 5 % 압축)
const B_SLIM       = 0.95;
// 눈 영역 (가로 확장 > 세로 확장)
const B_EYE_Y      = 0.38;   // 눈 중심 Y (프레임 높이 대비)
const B_EYE_DX     = 0.115;  // 눈 중심 X 오프셋 (프레임 너비 대비)
const B_EYE_RX     = 0.076;  // 눈 영역 x-반경
const B_EYE_RY     = 0.058;  // 눈 영역 y-반경
const B_EYE_ZX     = 1.060;  // 눈 가로 확대율
const B_EYE_ZY     = 1.032;  // 눈 세로 확대율 (가로보다 작게)
const B_EYE_ALPHA  = 0.85;   // 높은 알파 → 깔끔한 블렌딩 (귀신 효과 방지)
// 콧볼 축소
const B_NOSE_Y     = 0.545;  // 코 중심 Y
const B_NOSE_RX    = 0.068;  // 코 영역 x-반경
const B_NOSE_RY    = 0.050;  // 코 영역 y-반경
const B_NOSE_Z     = 0.86;   // 콧볼 가로 압축율
const B_NOSE_ALPHA = 0.62;
// 중안부 축소 (눈~코 구간 세로 압축)
const B_MF_TOP     = 0.415;  // 중안부 시작 Y (눈 바로 아래)
const B_MF_BOT     = 0.555;  // 중안부 끝 Y (윗입술 위)
const B_MF_W       = 0.48;   // 적용 너비 비율
const B_MF_Z       = 0.91;   // 세로 압축율 (9 % 축소)
const B_MF_ALPHA   = 0.68;

const SLOT_ASPECT = 4 / 3;
const CAPTURE_HEIGHT = 960;
const CAPTURE_WIDTH = Math.round(CAPTURE_HEIGHT * SLOT_ASPECT);
const SELECT_PREVIEW_SCALE = 0.74;
const SELECT_PREVIEW_HEIGHT = Math.round(806 * SELECT_PREVIEW_SCALE);

const THEME_OPTIONS: { id: FrameTheme; label: string; hint: string }[] = [
  { id: "green", label: "Green", hint: "다크 그린 · 칠판" },
  { id: "yellow", label: "Yellow", hint: "버터 옐로 · 경고" },
  { id: "purple", label: "Purple", hint: "연보라 · 현타" },
  { id: "red", label: "Red", hint: "다크 레드 · 자퇴각" },
  { id: "basicBlack", label: "Basic Black", hint: "기본 프레임 · 검정" },
  { id: "basicWhite", label: "Basic White", hint: "기본 프레임 · 흰색" },
];

const STORY_THEME_IDS: FrameTheme[] = ["green", "yellow", "purple", "red"];

export function SipgaeApp() {
  const [step, setStep] = useState<Step>("home");
  const [theme, setTheme] = useState<FrameTheme | null>(null);
  const [selectedTheme, setSelectedTheme] = useState<FrameTheme | null>(null);
  const [pendingTheme, setPendingTheme] = useState<FrameTheme | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [photos, setPhotos] = useState<(string | null)[]>(EMPTY);
  const [camError, setCamError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [staticCapture, setStaticCapture] = useState(false);
  const [tick, setTick] = useState(7);
  const [shotFxOn, setShotFxOn] = useState(false);
  const [shotNotice, setShotNotice] = useState<string | null>(null);
  const [storyIndex, setStoryIndex] = useState(0);
  const [basicIndex, setBasicIndex] = useState(0);

  const storyThemeOptions = THEME_OPTIONS.filter((opt) => STORY_THEME_IDS.includes(opt.id));
  const basicThemeOptions = THEME_OPTIONS.filter((opt) => !STORY_THEME_IDS.includes(opt.id));
  const currentStoryTheme = storyThemeOptions[storyIndex % storyThemeOptions.length];
  const currentBasicTheme = basicThemeOptions[basicIndex % basicThemeOptions.length];

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const renderRafRef = useRef<number | null>(null);
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const getCenterCropRect = useCallback((srcW: number, srcH: number, targetAspect: number) => {
    const srcAspect = srcW / srcH;
    if (srcAspect > targetAspect) {
      const cropW = srcH * targetAspect;
      return {
        sx: (srcW - cropW) * 0.5,
        sy: 0,
        sw: cropW,
        sh: srcH,
      };
    }
    const cropH = srcW / targetAspect;
    return {
      sx: 0,
      sy: (srcH - cropH) * 0.5,
      sw: srcW,
      sh: cropH,
    };
  }, []);

  const captureFromVideo = useCallback(() => {
    const preview = previewCanvasRef.current;
    const c = canvasRef.current;
    const v = videoRef.current;
    if (!c) return null;

    // Primary source: processed preview canvas (mirror + beauty + reshape).
    if (preview && preview.width > 0 && preview.height > 0) {
      c.width = CAPTURE_WIDTH;
      c.height = CAPTURE_HEIGHT;
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      const { sx, sy, sw, sh } = getCenterCropRect(preview.width, preview.height, SLOT_ASPECT);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(preview, sx, sy, sw, sh, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.95);
    }

    // Fallback when preview pipeline is not ready.
    if (!v || v.readyState < 2) return null;
    const w = v.videoWidth;
    const h = v.videoHeight;
    if (!w || !h) return null;
    c.width = CAPTURE_WIDTH;
    c.height = CAPTURE_HEIGHT;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const { sx, sy, sw, sh } = getCenterCropRect(w, h, SLOT_ASPECT);
    // Preview is mirrored; capture must preserve the same mirror orientation.
    // Filter is applied at draw time so saved frame keeps the same look.
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.filter = CAMERA_FILTER;
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
    ctx.restore();
    return c.toDataURL("image/jpeg", 0.95);
  }, [getCenterCropRect]);

  const drawBeautyWarpFrame = useCallback(() => {
    const video = videoRef.current;
    const preview = previewCanvasRef.current;
    if (!video || !preview || video.readyState < 2) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    if (preview.width !== vw || preview.height !== vh) {
      preview.width = vw;
      preview.height = vh;
    }

    let work = workCanvasRef.current;
    if (!work) {
      work = document.createElement("canvas");
      workCanvasRef.current = work;
    }
    if (work.width !== vw || work.height !== vh) {
      work.width = vw;
      work.height = vh;
    }

    const wctx = work.getContext("2d");
    const ctx = preview.getContext("2d");
    if (!ctx || !wctx) return;

    // 고화질 보간 설정
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    wctx.imageSmoothingEnabled = true;
    wctx.imageSmoothingQuality = "high";

    // ── Pass 1: 좌우 반전 + 미백 필터 → work ─────────────────────────────
    wctx.save();
    wctx.clearRect(0, 0, vw, vh);
    wctx.filter = CAMERA_FILTER;
    wctx.translate(vw, 0);
    wctx.scale(-1, 1);
    wctx.drawImage(video, 0, 0, vw, vh);
    wctx.restore();

    // ── Pass 2: 얼굴 갸름 (가로 5 % 압축) ───────────────────────────────
    ctx.clearRect(0, 0, vw, vh);
    const strip = Math.round(vw * (1 - B_SLIM) / 2);
    if (strip > 0) {
      ctx.drawImage(work, 0, 0, 3, vh, 0, 0, strip, vh);
      ctx.drawImage(work, vw - 3, 0, 3, vh, vw - strip, 0, strip, vh);
    }
    ctx.drawImage(work, 0, 0, vw, vh, strip, 0, vw - strip * 2, vh);

    // work ← 현재 preview 상태로 갱신
    wctx.clearRect(0, 0, vw, vh);
    wctx.drawImage(preview, 0, 0);

    // ── Pass 3: 눈 확대 (가로 > 세로, 타원 클립 + 높은 알파) ─────────────
    const cx = vw / 2;
    const eyeY = vh * B_EYE_Y;
    const eyeOffX = vw * B_EYE_DX;
    const rx = vw * B_EYE_RX;
    const ry = vh * B_EYE_RY;

    const enlargeEye = (ex: number) => {
      const sw = rx * 2;
      const sh = ry * 2;
      const dw = sw * B_EYE_ZX;
      const dh = sh * B_EYE_ZY;
      ctx.save();
      ctx.beginPath();
      // 클립 영역을 소스보다 약간 작게 → 경계가 자연스럽게 페이드
      ctx.ellipse(ex, eyeY, rx * 0.86, ry * 0.86, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.globalAlpha = B_EYE_ALPHA;
      ctx.drawImage(work, ex - rx, eyeY - ry, sw, sh, ex - dw / 2, eyeY - dh / 2, dw, dh);
      ctx.restore();
    };

    enlargeEye(cx - eyeOffX);
    enlargeEye(cx + eyeOffX);

    // work ← 갱신
    wctx.clearRect(0, 0, vw, vh);
    wctx.drawImage(preview, 0, 0);

    // ── Pass 4: 콧볼 축소 (코 영역 가로 압축) ───────────────────────────
    const noseY = vh * B_NOSE_Y;
    const nrx = vw * B_NOSE_RX;
    const nry = vh * B_NOSE_RY;
    const ndw = nrx * 2 * B_NOSE_Z;

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, noseY, nrx * 0.82, nry * 0.82, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalAlpha = B_NOSE_ALPHA;
    ctx.drawImage(work, cx - nrx, noseY - nry, nrx * 2, nry * 2,
                        cx - ndw / 2, noseY - nry, ndw, nry * 2);
    ctx.restore();

    // work ← 갱신
    wctx.clearRect(0, 0, vw, vh);
    wctx.drawImage(preview, 0, 0);

    // ── Pass 5: 중안부 축소 (눈~코 구간 세로 압축) ──────────────────────
    const mfTopY = vh * B_MF_TOP;
    const mfBotY = vh * B_MF_BOT;
    const mfSrcH = mfBotY - mfTopY;
    const mfDstH = mfSrcH * B_MF_Z;
    const mfW = vw * B_MF_W;
    const mfCY = (mfTopY + mfBotY) / 2;

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, mfCY, mfW * 0.44, mfSrcH * 0.44, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalAlpha = B_MF_ALPHA;
    ctx.drawImage(work,
      cx - mfW / 2, mfTopY, mfW, mfSrcH,
      cx - mfW / 2, mfCY - mfDstH / 2, mfW, mfDstH,
    );
    ctx.restore();
  }, []);

  useEffect(() => {
    if (step !== "shoot") {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      return;
    }
    let cancelled = false;
    setCamError(null);
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280, min: 640 },
            height: { ideal: 720, min: 480 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const el = videoRef.current;
        if (el) el.srcObject = stream;
      } catch (e) {
        setCamError(e instanceof Error ? e.message : "카메라를 켤 수 없어요.");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [step]);

  useEffect(() => {
    if (step !== "shoot") return;
    let stopped = false;
    const loop = () => {
      if (stopped) return;
      drawBeautyWarpFrame();
      renderRafRef.current = window.requestAnimationFrame(loop);
    };
    renderRafRef.current = window.requestAnimationFrame(loop);
    return () => {
      stopped = true;
      if (renderRafRef.current != null) {
        window.cancelAnimationFrame(renderRafRef.current);
        renderRafRef.current = null;
      }
    };
  }, [step, drawBeautyWarpFrame]);

  useEffect(() => {
    if (step !== "shoot") return;
    const id = window.setInterval(() => {
      setPhotos((prev) => {
        const idx = prev.findIndex((p) => p == null);
        if (idx === -1) return prev;
        const data = captureFromVideo();
        if (!data) return prev;
        const next = [...prev];
        next[idx] = data;
        return next;
      });
    }, 7000);
    return () => window.clearInterval(id);
  }, [step, captureFromVideo]);

  const filled = photos.filter(Boolean).length;

  useEffect(() => {
    if (step !== "shoot") return;
    if (filled >= 4) setStep("done");
  }, [step, filled]);

  useEffect(() => {
    if (step !== "shoot" || filled >= 4) return;
    // Ensure stale flash state does not leak into a new shoot session.
    setShotFxOn(false);
    setShotNotice(null);
    setTick(7);
    const id = window.setInterval(() => {
      setTick((s) => (s <= 1 ? 7 : s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [step, filled]);

  useEffect(() => {
    if (step !== "shoot") return;
    if (filled <= 0 || filled > 4) return;
    setShotFxOn(true);
    setShotNotice(`찰칵! ${filled}/4`);
    const t1 = window.setTimeout(() => setShotFxOn(false), 140);
    const t2 = window.setTimeout(() => setShotNotice(null), 900);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [filled, step]);

  useEffect(() => {
    if (step !== "loading") return;
    const t = window.setTimeout(() => {
      setPhotos([...EMPTY]);
      setStep("shoot");
    }, 3000);
    return () => window.clearTimeout(t);
  }, [step]);

  const openPayment = (t: FrameTheme) => {
    setPendingTheme(null);
    setPaymentOpen(false);
    setTheme(t);
    setStep("loading");
  };

  const confirmPayment = () => {
    if (!pendingTheme) return;
    setPaymentOpen(false);
    setTheme(pendingTheme);
    setStep("loading");
  };

  const downloadPng = async () => {
    if (!frameRef.current) return;
    setExporting(true);
    setStaticCapture(true);
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    try {
      const canvas = await html2canvas(frameRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: null,
        logging: false,
      });
      await new Promise<void>((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("blob"));
              return;
            }
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `sipgae-${theme ?? "frame"}-${Date.now()}.png`;
            a.click();
            URL.revokeObjectURL(url);
            resolve();
          },
          "image/png",
          1
        );
      });
    } catch {
      /* ignore */
    } finally {
      setStaticCapture(false);
      setExporting(false);
    }
  };

  const restart = () => {
    setStep("home");
    setTheme(null);
    setSelectedTheme(null);
    setPendingTheme(null);
    setPhotos([...EMPTY]);
    setCamError(null);
    setPaymentOpen(false);
    setShotFxOn(false);
    setShotNotice(null);
    setTick(7);
  };

  return (
    <>
      <FloatingBackground />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "32px 20px 48px",
        }}
      >
        {step === "home" && (
          <main
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              maxWidth: 420,
              textAlign: "center",
            }}
          >
            <img
              src="/home-dog-icon-transparent.png"
              alt="일상네컷 강아지 아이콘"
              style={{
                width: 188,
                height: 188,
                objectFit: "contain",
                filter: "drop-shadow(0 6px 16px rgba(90, 60, 120, 0.15))",
                marginBottom: -16,
              }}
            />
            <h1
              style={{
                fontSize: "2.06rem",
                color: "#4f3b79",
                fontWeight: 900,
                letterSpacing: "0.5px",
                lineHeight: 1.2,
              }}
            >
              일상네컷
            </h1>
            <p
              style={{
                fontSize: "1.2rem",
                color: "#5b4585",
                lineHeight: 1.45,
                fontWeight: 800,
              }}
            >
              당신의 소중한 일상을 담고 싶개
            </p>
            <p style={{ fontSize: "0.93rem", color: "#756687", opacity: 0.95, lineHeight: 1.6 }}>
              여러분의 일상을 네컷으로 담아보세요
            </p>
            <button
              type="button"
              onClick={() => setStep("select")}
              style={{
                marginTop: 12,
                padding: "14px 32px",
                fontSize: "1.05rem",
                fontFamily: "inherit",
                border: "none",
                borderRadius: 999,
                background: "linear-gradient(135deg, #c8a8f0, #a8d8e8)",
                color: "#2a2040",
                boxShadow: "0 6px 20px rgba(90, 60, 140, 0.25)",
                cursor: "pointer",
              }}
            >
              시작하기
            </button>
          </main>
        )}

        {step === "select" && (
          <main style={{ width: "100%", maxWidth: 760 }}>
            <button
              type="button"
              onClick={() => setStep("home")}
              style={{
                marginBottom: 20,
                padding: "8px 14px",
                fontFamily: "inherit",
                borderRadius: 10,
                border: "1px solid rgba(90,60,140,0.2)",
                background: "rgba(255,255,255,0.6)",
                cursor: "pointer",
              }}
            >
              ← 홈
            </button>
            <h2 style={{ fontSize: "1.35rem", marginBottom: 8, color: "#4a3868" }}>프레임 선택</h2>
            <p style={{ fontSize: "0.88rem", color: "#6a5888", marginBottom: 24 }}>
              원하시는 프레임을 선택한 후 촬영하기 버튼을 눌러주세요
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 14,
                alignItems: "start",
              }}
            >
              <div>
                <p style={{ fontSize: "0.82rem", color: "#6d5b88", marginBottom: 10 }}>싶개 프레임</p>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <button
                  type="button"
                  onClick={() =>
                    setStoryIndex((prev) => (prev - 1 + storyThemeOptions.length) % storyThemeOptions.length)
                  }
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    border: "1px solid rgba(90,60,140,0.28)",
                    background: "rgba(255,255,255,0.72)",
                    cursor: "pointer",
                    fontSize: "1.1rem",
                  }}
                  aria-label="이전 프레임"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedTheme(currentStoryTheme.id)}
                  style={{
                    padding: "10px 8px 6px",
                    borderRadius: 14,
                    border:
                      selectedTheme === currentStoryTheme.id
                        ? "2px solid #6f56b5"
                        : "2px solid transparent",
                    background:
                      selectedTheme === currentStoryTheme.id
                        ? "rgba(255,255,255,0.9)"
                        : "rgba(255,255,255,0.58)",
                    fontFamily: "inherit",
                    cursor: "pointer",
                    textAlign: "center",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 2,
                    width: 236,
                  }}
                >
                  <div style={{ width: 260, height: SELECT_PREVIEW_HEIGHT, display: "flex", justifyContent: "center", overflow: "hidden" }}>
                    <div style={{ transform: `scale(${SELECT_PREVIEW_SCALE})`, transformOrigin: "top center" }}>
                      <PhotoFrame theme={currentStoryTheme.id} photos={EMPTY} slotReadonly previewMode />
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setStoryIndex((prev) => (prev + 1) % storyThemeOptions.length)}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    border: "1px solid rgba(90,60,140,0.28)",
                    background: "rgba(255,255,255,0.72)",
                    cursor: "pointer",
                    fontSize: "1.1rem",
                  }}
                  aria-label="다음 프레임"
                >
                  ›
                </button>
              </div>
              </div>
              <div>
                <p style={{ fontSize: "0.82rem", color: "#6d5b88", marginBottom: 10 }}>기본 프레임</p>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <button
                  type="button"
                  onClick={() =>
                    setBasicIndex((prev) => (prev - 1 + basicThemeOptions.length) % basicThemeOptions.length)
                  }
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    border: "1px solid rgba(90,60,140,0.28)",
                    background: "rgba(255,255,255,0.72)",
                    cursor: "pointer",
                    fontSize: "1.1rem",
                  }}
                  aria-label="이전 기본 프레임"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedTheme(currentBasicTheme.id)}
                  style={{
                    padding: "10px 8px 6px",
                    borderRadius: 14,
                    border:
                      selectedTheme === currentBasicTheme.id
                        ? "2px solid #6f56b5"
                        : "2px solid transparent",
                    background:
                      selectedTheme === currentBasicTheme.id
                        ? "rgba(255,255,255,0.9)"
                        : "rgba(255,255,255,0.58)",
                    fontFamily: "inherit",
                    cursor: "pointer",
                    textAlign: "center",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 2,
                    width: 236,
                  }}
                >
                  <div style={{ width: 260, height: SELECT_PREVIEW_HEIGHT, display: "flex", justifyContent: "center", overflow: "hidden" }}>
                    <div style={{ transform: `scale(${SELECT_PREVIEW_SCALE})`, transformOrigin: "top center" }}>
                      <PhotoFrame theme={currentBasicTheme.id} photos={EMPTY} slotReadonly previewMode />
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setBasicIndex((prev) => (prev + 1) % basicThemeOptions.length)}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    border: "1px solid rgba(90,60,140,0.28)",
                    background: "rgba(255,255,255,0.72)",
                    cursor: "pointer",
                    fontSize: "1.1rem",
                  }}
                  aria-label="다음 기본 프레임"
                >
                  ›
                </button>
              </div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "center", marginTop: 22 }}>
              <button
                type="button"
                disabled={!selectedTheme}
                onClick={() => selectedTheme && openPayment(selectedTheme)}
                style={{
                  padding: "13px 28px",
                  borderRadius: 999,
                  border: "none",
                  fontFamily: "inherit",
                  fontSize: "0.98rem",
                  cursor: selectedTheme ? "pointer" : "not-allowed",
                  opacity: selectedTheme ? 1 : 0.55,
                  background: "linear-gradient(135deg, #b8a0e0, #90c0e8)",
                  color: "#1a1028",
                }}
              >
                촬영하기
              </button>
            </div>
          </main>
        )}

        {paymentOpen && (
          <div
            role="dialog"
            aria-modal
            aria-labelledby="pay-title"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 50,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
              background: "rgba(40, 30, 60, 0.45)",
            }}
          >
            <div
              style={{
                maxWidth: 380,
                width: "100%",
                padding: "28px 24px",
                borderRadius: 20,
                background: "#fffefb",
                boxShadow: "0 20px 50px rgba(0,0,0,0.15)",
              }}
            >
              <h2 id="pay-title" style={{ fontSize: "1.2rem", marginBottom: 12, color: "#4a3868" }}>
                양심 결제 1,000원
              </h2>
              <p style={{ fontSize: "0.95rem", lineHeight: 1.55, color: "#5a4868", marginBottom: 16 }}>
                당신의 양심을 믿습니다.
              </p>
              <p style={{ fontSize: "0.85rem", lineHeight: 1.5, color: "#7a6888", marginBottom: 20 }}>
                아래 계좌로 1,000원을 송금해 주세요. (데모: 실제 계좌는 운영 시 설정)
                <br />
                <strong>은행 · 계좌번호</strong> 플레이스홀더
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setPaymentOpen(false)}
                  style={{
                    flex: 1,
                    minWidth: 100,
                    padding: "12px 16px",
                    fontFamily: "inherit",
                    borderRadius: 12,
                    border: "1px solid #ccc",
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  닫기
                </button>
                <button
                  type="button"
                  onClick={confirmPayment}
                  style={{
                    flex: 1,
                    minWidth: 120,
                    padding: "12px 16px",
                    fontFamily: "inherit",
                    borderRadius: 12,
                    border: "none",
                    background: "linear-gradient(135deg, #b8a0e0, #90c0e8)",
                    color: "#1a1028",
                    cursor: "pointer",
                  }}
                >
                  입금 완료
                </button>
              </div>
            </div>
          </div>
        )}

        {step === "loading" && (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
            }}
          >
            <p style={{ fontSize: "1.4rem" }}>준비 중…</p>
            <p style={{ fontSize: "0.9rem", color: "#6a5888" }}>3초 후 촬영 화면으로 이동해요.</p>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                border: "4px solid #e8d8ff",
                borderTopColor: "#9060d8",
                animation: "sipgae-spin 0.9s linear infinite",
              }}
            />
            <style>{`@keyframes sipgae-spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {step === "shoot" && (
          <main
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 30,
              background: "#111",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <video
              className="shoot-video"
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
            />
            <canvas
              ref={previewCanvasRef}
              className="shoot-canvas"
              style={{ width: "100vw", height: "100vh" }}
            />
            <canvas ref={canvasRef} style={{ display: "none" }} />
            <div
              style={{
                position: "absolute",
                top: 20,
                left: "50%",
                transform: "translateX(-50%)",
                padding: "10px 16px",
                borderRadius: 999,
                background: "rgba(0,0,0,0.55)",
                color: "#fff",
                fontSize: "0.95rem",
              }}
            >
              {camError ? "카메라 오류 발생" : `촬영 ${filled + 1}/4 · ${tick}초 후 촬영`}
            </div>
            {shotNotice && (
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  bottom: 26,
                  transform: "translateX(-50%)",
                  padding: "12px 18px",
                  borderRadius: 999,
                  background: "rgba(0,0,0,0.68)",
                  color: "#fff",
                  fontSize: "1rem",
                  letterSpacing: "0.3px",
                }}
              >
                {shotNotice}
              </div>
            )}
            {shotFxOn && (
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "rgba(255,255,255,0.88)",
                  pointerEvents: "none",
                }}
              />
            )}
            {camError && (
              <p
                style={{
                  position: "absolute",
                  bottom: 24,
                  left: "50%",
                  transform: "translateX(-50%)",
                  color: "#ffd7df",
                  fontSize: "0.9rem",
                  background: "rgba(90, 20, 30, 0.72)",
                  borderRadius: 12,
                  padding: "10px 14px",
                }}
              >
                {camError}
              </p>
            )}
          </main>
        )}

        {step === "done" && theme && (
          <main style={{ width: "100%", maxWidth: 720, display: "flex", flexDirection: "column", gap: 24 }}>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <div style={{ flex: "0 0 auto" }}>
                <p style={{ fontSize: "0.9rem", marginBottom: 8, color: "#4a3868", textAlign: "center" }}>
                  완성된 네컷 프레임
                </p>
                <PhotoFrame
                  ref={frameRef}
                  theme={theme}
                  photos={photos}
                  slotReadonly
                  staticForCapture={staticCapture}
                />
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
              <button
                type="button"
                disabled={exporting}
                onClick={downloadPng}
                style={{
                  padding: "14px 28px",
                  fontSize: "1rem",
                  fontFamily: "inherit",
                  border: "none",
                  borderRadius: 999,
                  background: "linear-gradient(135deg, #7fc99a, #6ab0d8)",
                  color: "#102018",
                  cursor: exporting ? "wait" : "pointer",
                }}
              >
                {exporting ? "저장 중…" : "고화질 이미지 저장"}
              </button>
              <button
                type="button"
                onClick={restart}
                style={{
                  padding: "14px 24px",
                  fontSize: "1rem",
                  fontFamily: "inherit",
                  borderRadius: 999,
                  border: "1px solid rgba(90,60,140,0.3)",
                  background: "rgba(255,255,255,0.7)",
                  cursor: "pointer",
                }}
              >
                처음으로
              </button>
            </div>
          </main>
        )}
      </div>
    </>
  );
}
