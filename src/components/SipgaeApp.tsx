"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FloatingBackground } from "./FloatingBackground";
import { BASIC_FRAME_SLOT_ASPECT, PhotoFrame, type FrameTheme } from "./PhotoFrame";
import { WebGLBeautyRenderer } from "./WebGLBeautyRenderer";

type Step = "home" | "select" | "loading" | "shoot" | "done";

const EMPTY: (string | null)[] = [null, null, null, null];
// Face Mesh landmark lerp smoothing factor
const LERP_S = 0.12;
/** 멍개·일러스트 프레임 사진칸(4:3 캡처) */
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
  { id: "dailyEditionDropout", label: "Daily Edition", hint: "일상네컷 에디션" },
  { id: "dailyEditionHomeGo", label: "Daily Edition", hint: "일상네컷 에디션" },
];

const BASIC_THEME_IDS: FrameTheme[] = ["basicBlack", "basicWhite"];
const DAILY_EDITION_THEME_IDS: FrameTheme[] = ["dailyEditionDropout", "dailyEditionHomeGo"];

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
  const [basicIndex, setBasicIndex] = useState(0);
  const [dailyEditionIndex, setDailyEditionIndex] = useState(0);

  const dailyEditionThemeOptions = THEME_OPTIONS.filter((opt) => DAILY_EDITION_THEME_IDS.includes(opt.id));
  const basicThemeOptions = THEME_OPTIONS.filter(
    (opt) => BASIC_THEME_IDS.includes(opt.id)
  );
  const currentDailyEditionTheme = dailyEditionThemeOptions[dailyEditionIndex % dailyEditionThemeOptions.length];
  const currentBasicTheme = basicThemeOptions[basicIndex % basicThemeOptions.length];

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const renderRafRef = useRef<number | null>(null);
  const rendererRef  = useRef<WebGLBeautyRenderer | null>(null);
  // MediaPipe Face Mesh — 468+10 iris 랜드마크
  const faceMeshRef       = useRef<unknown>(null);
  const faceMeshReadyRef  = useRef(false);
  const faceMeshRunningRef = useRef(false);
  const lastFaceMeshMsRef = useRef(0);
  const landmarksRef      = useRef<{ x: number; y: number; z: number }[] | null>(null);

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

    const useBasicSlotAspect = theme === "basicBlack" || theme === "basicWhite";
    const aspect = useBasicSlotAspect ? BASIC_FRAME_SLOT_ASPECT : SLOT_ASPECT;
    const capW = useBasicSlotAspect ? Math.round(CAPTURE_HEIGHT * aspect) : CAPTURE_WIDTH;
    const capH = CAPTURE_HEIGHT;

    // Primary source: processed preview canvas (mirror + beauty + reshape).
    if (preview && preview.width > 0 && preview.height > 0) {
      c.width = capW;
      c.height = capH;
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      const { sx, sy, sw, sh } = getCenterCropRect(preview.width, preview.height, aspect);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(preview, sx, sy, sw, sh, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.95);
    }

    // Fallback when preview pipeline is not ready.
    if (!v || v.readyState < 2) return null;
    const w = v.videoWidth;
    const h = v.videoHeight;
    if (!w || !h) return null;
    c.width = capW;
    c.height = capH;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const { sx, sy, sw, sh } = getCenterCropRect(w, h, aspect);
    // Fallback: mirror only (WebGL LUT not available at this point)
    ctx.save();
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
    ctx.restore();
    return c.toDataURL("image/jpeg", 0.95);
  }, [getCenterCropRect, theme]);

  const drawBeautyWarpFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;

    // ── Face Mesh 비동기 갱신 (80 ms 쓰로틀) ─────────────────────────────
    const now = Date.now();
    if (
      faceMeshReadyRef.current &&
      !faceMeshRunningRef.current &&
      now - lastFaceMeshMsRef.current > 80
    ) {
      lastFaceMeshMsRef.current = now;
      faceMeshRunningRef.current = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (faceMeshRef.current as any).send({ image: video }).finally(() => {
        faceMeshRunningRef.current = false;
      });
    }

    // ── WebGL 렌더 (LUT + 피부 소프트닝, 전부 GPU) ────────────────────────
    rendererRef.current?.render(video, landmarksRef.current);
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
          video: { facingMode: "user", width: { ideal: 1280, min: 640 }, height: { ideal: 720, min: 480 } },
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

  // ── WebGL 렌더러 초기화 ────────────────────────────────────────────────
  useEffect(() => {
    if (step !== "shoot") return;
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    let renderer: WebGLBeautyRenderer;
    try {
      renderer = new WebGLBeautyRenderer(canvas);
      rendererRef.current = renderer;
    } catch (e) {
      console.warn("[WebGL] init failed, beauty filter disabled:", e);
    }
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [step]);

  // ── MediaPipe Face Mesh 초기화 ─────────────────────────────────────────
  useEffect(() => {
    if (step !== "shoot") return;
    let destroyed = false;

    (async () => {
      try {
        const { FaceMesh } = await import("@mediapipe/face_mesh");
        if (destroyed) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mesh = new (FaceMesh as any)({
          locateFile: (file: string) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`,
        });
        mesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        mesh.onResults((results: { multiFaceLandmarks?: { x: number; y: number; z: number }[][] }) => {
          if (destroyed) return;
          const raw = results.multiFaceLandmarks?.[0];
          if (!raw || !raw.length) { landmarksRef.current = null; return; }
          // lerp 스무딩으로 jitter 방지 (s=0.15)
          const prev = landmarksRef.current;
          if (prev && prev.length === raw.length) {
            landmarksRef.current = raw.map((lm, i) => ({
              x: prev[i].x * (1 - LERP_S) + lm.x * LERP_S,
              y: prev[i].y * (1 - LERP_S) + lm.y * LERP_S,
              z: prev[i].z * (1 - LERP_S) + lm.z * LERP_S,
            }));
          } else {
            landmarksRef.current = raw.map((lm) => ({ ...lm }));
          }
        });
        faceMeshRef.current = mesh;
        faceMeshReadyRef.current = true;
      } catch { /* MediaPipe 로드 실패 — 보정 없이 계속 */ }
    })();

    return () => {
      destroyed = true;
      faceMeshReadyRef.current = false;
      faceMeshRunningRef.current = false;
      landmarksRef.current = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (faceMeshRef.current as any)?.close?.();
      faceMeshRef.current = null;
    };
  }, [step]);

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
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(frameRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: null,
        logging: false,
      });
      await new Promise<void>((resolve, reject) => {
        canvas.toBlob(
          async (blob) => {
            if (!blob) { reject(new Error("blob")); return; }
            const filename = `sipgae-${theme ?? "frame"}-${Date.now()}.png`;
            const file = new File([blob], filename, { type: "image/png" });

            // 모바일: Web Share API로 갤러리 저장 가능하게
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (navigator.share && (navigator as any).canShare?.({ files: [file] })) {
              try {
                await navigator.share({ files: [file], title: "일상네컷" });
                resolve();
                return;
              } catch {
                /* 취소 또는 미지원 → fallback */
              }
            }

            // 데스크톱 / fallback: <a download> 트리거
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
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
          zIndex: 10,
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
              src="/최종로고.png"
              alt="일상네컷 강아지 아이콘"
              style={{
                width: 250,
                height: 250,
                objectFit: "contain",
                filter: "drop-shadow(0 4px 12px rgba(0, 0, 0, 0.12))",
                marginBottom: -36,
              }}
            />
            <h1
              style={{
                fontSize: "2.2rem",
                color: "#111111",
                fontWeight: 400,
                letterSpacing: "1px",
                lineHeight: 1.2,
              }}
            >
              일상네컷
            </h1>
            <p
              style={{
                fontSize: "1.15rem",
                color: "#222222",
                lineHeight: 1.45,
              }}
            >
              일상을 소중하개
            </p>
            <p style={{ fontSize: "0.95rem", color: "#666666", lineHeight: 1.6 }}>
              여러분의 일상을 네컷으로 담아보세요
            </p>
            <button
              type="button"
              onClick={() => setStep("select")}
              style={{
                position: "relative",
                zIndex: 1,
                marginTop: 16,
                padding: "13px 36px",
                fontSize: "1.05rem",
                fontFamily: "inherit",
                border: "2px solid #111111",
                borderRadius: "4px",
                background: "#111111",
                color: "#ffffff",
                boxShadow: "4px 4px 0 rgba(0, 0, 0, 0.2)",
                cursor: "pointer",
                letterSpacing: "1.5px",
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
                padding: "7px 14px",
                fontFamily: "inherit",
                borderRadius: "3px",
                border: "1.5px solid rgba(0, 0, 0, 0.35)",
                background: "rgba(255, 255, 255, 0.85)",
                color: "#111111",
                cursor: "pointer",
                boxShadow: "2px 2px 0 rgba(0, 0, 0, 0.1)",
              }}
            >
              ← 홈
            </button>
            <h2 style={{ fontSize: "1.35rem", marginBottom: 8, color: "#111111" }}>프레임 선택</h2>
            <p style={{ fontSize: "0.88rem", color: "#666666", marginBottom: 6 }}>
              원하시는 프레임을 선택한 후 촬영하기 버튼을 눌러주세요
            </p>
            <p style={{ fontSize: "0.76rem", color: "#999999", marginBottom: 20 }}>
              (핸드폰으로 촬영할경우 양옆이 조금씩 잘려서 나오니 중앙에 모여서 찍어주세요)
            </p>
            <div className="frame-grid">
              <div>
                <p style={{ fontSize: "0.82rem", color: "#666666", marginBottom: 10 }}>멍개 프레임</p>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <button
                  type="button"
                  onClick={() =>
                    setDailyEditionIndex(
                      (prev) => (prev - 1 + dailyEditionThemeOptions.length) % dailyEditionThemeOptions.length
                    )
                  }
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    border: "1.5px solid rgba(0, 0, 0, 0.35)",
                    background: "rgba(255, 255, 255, 0.9)",
                    color: "#111111",
                    cursor: "pointer",
                    fontSize: "1.1rem",
                    boxShadow: "2px 2px 0 rgba(0, 0, 0, 0.1)",
                  }}
                  aria-label="이전 멍개 프레임"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedTheme(currentDailyEditionTheme.id)}
                  style={{
                    padding: "10px 8px 6px",
                    borderRadius: "6px",
                    border:
                      selectedTheme === currentDailyEditionTheme.id
                        ? "2px solid #111111"
                        : "1.5px solid rgba(0, 0, 0, 0.2)",
                    background:
                      selectedTheme === currentDailyEditionTheme.id
                        ? "rgba(255, 255, 255, 0.95)"
                        : "rgba(255, 255, 255, 0.6)",
                    boxShadow:
                      selectedTheme === currentDailyEditionTheme.id
                        ? "3px 3px 0 rgba(0, 0, 0, 0.18)"
                        : "1px 1px 0 rgba(0, 0, 0, 0.06)",
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
                      <PhotoFrame theme={currentDailyEditionTheme.id} photos={EMPTY} slotReadonly previewMode />
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDailyEditionIndex((prev) => (prev + 1) % dailyEditionThemeOptions.length)
                  }
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    border: "1.5px solid rgba(0, 0, 0, 0.35)",
                    background: "rgba(255, 255, 255, 0.9)",
                    color: "#111111",
                    cursor: "pointer",
                    fontSize: "1.1rem",
                    boxShadow: "2px 2px 0 rgba(0, 0, 0, 0.1)",
                  }}
                  aria-label="다음 멍개 프레임"
                >
                  ›
                </button>
              </div>
              </div>
              <div>
                <p style={{ fontSize: "0.82rem", color: "#666666", marginBottom: 10 }}>기본 프레임</p>
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
                    border: "1.5px solid rgba(0, 0, 0, 0.35)",
                    background: "rgba(255, 255, 255, 0.9)",
                    color: "#111111",
                    cursor: "pointer",
                    fontSize: "1.1rem",
                    boxShadow: "2px 2px 0 rgba(0, 0, 0, 0.1)",
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
                    borderRadius: "6px",
                    border:
                      selectedTheme === currentBasicTheme.id
                        ? "2px solid #111111"
                        : "1.5px solid rgba(0, 0, 0, 0.2)",
                    background:
                      selectedTheme === currentBasicTheme.id
                        ? "rgba(255, 255, 255, 0.95)"
                        : "rgba(255, 255, 255, 0.6)",
                    boxShadow:
                      selectedTheme === currentBasicTheme.id
                        ? "3px 3px 0 rgba(0, 0, 0, 0.18)"
                        : "1px 1px 0 rgba(0, 0, 0, 0.06)",
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
                    border: "1.5px solid rgba(0, 0, 0, 0.35)",
                    background: "rgba(255, 255, 255, 0.9)",
                    color: "#111111",
                    cursor: "pointer",
                    fontSize: "1.1rem",
                    boxShadow: "2px 2px 0 rgba(0, 0, 0, 0.1)",
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
                  padding: "13px 32px",
                  borderRadius: "4px",
                  border: "2px solid #111111",
                  fontFamily: "inherit",
                  fontSize: "0.98rem",
                  cursor: selectedTheme ? "pointer" : "not-allowed",
                  opacity: selectedTheme ? 1 : 0.5,
                  background: selectedTheme ? "#111111" : "rgba(0, 0, 0, 0.2)",
                  color: selectedTheme ? "#ffffff" : "#666666",
                  boxShadow: selectedTheme ? "4px 4px 0 rgba(0, 0, 0, 0.2)" : "none",
                  letterSpacing: "1.5px",
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
              background: "rgba(0, 0, 0, 0.4)",
            }}
          >
            <div
              style={{
                maxWidth: 380,
                width: "100%",
                padding: "28px 24px",
                borderRadius: "8px",
                border: "2px solid #111111",
                background: "#ffffff",
                boxShadow: "6px 6px 0 rgba(0, 0, 0, 0.15), 0 20px 40px rgba(0,0,0,0.12)",
              }}
            >
              <h2 id="pay-title" style={{ fontSize: "1.2rem", marginBottom: 12, color: "#111111" }}>
                양심 결제 1,000원
              </h2>
              <p style={{ fontSize: "0.95rem", lineHeight: 1.55, color: "#222222", marginBottom: 16 }}>
                당신의 양심을 믿습니다.
              </p>
              <p style={{ fontSize: "0.85rem", lineHeight: 1.5, color: "#666666", marginBottom: 20 }}>
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
                    borderRadius: "4px",
                    border: "1.5px solid rgba(0, 0, 0, 0.3)",
                    background: "#ffffff",
                    color: "#111111",
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
                    borderRadius: "4px",
                    border: "2px solid #111111",
                    background: "#111111",
                    color: "#ffffff",
                    cursor: "pointer",
                    boxShadow: "3px 3px 0 rgba(0, 0, 0, 0.2)",
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
            <p style={{ fontSize: "1.4rem", color: "#111111" }}>준비 중…</p>
            <p style={{ fontSize: "0.9rem", color: "#666666" }}>3초 후 촬영 화면으로 이동해요.</p>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                border: "4px solid rgba(0, 0, 0, 0.15)",
                borderTopColor: "#111111",
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
                <p style={{ fontSize: "0.9rem", marginBottom: 8, color: "#222222", textAlign: "center" }}>
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
                  padding: "13px 28px",
                  fontSize: "1rem",
                  fontFamily: "inherit",
                  border: "2px solid #111111",
                  borderRadius: "4px",
                  background: "#111111",
                  color: "#ffffff",
                  cursor: exporting ? "wait" : "pointer",
                  boxShadow: "3px 3px 0 rgba(0, 0, 0, 0.2)",
                  letterSpacing: "1px",
                }}
              >
                {exporting ? "저장 중…" : "고화질 이미지 저장"}
              </button>
              <button
                type="button"
                onClick={restart}
                style={{
                  padding: "13px 24px",
                  fontSize: "1rem",
                  fontFamily: "inherit",
                  borderRadius: "4px",
                  border: "1.5px solid rgba(0, 0, 0, 0.35)",
                  background: "rgba(255, 255, 255, 0.85)",
                  color: "#111111",
                  cursor: "pointer",
                  boxShadow: "2px 2px 0 rgba(0, 0, 0, 0.1)",
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

export default SipgaeApp;
