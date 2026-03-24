"use client";

import html2canvas from "html2canvas";
import { useCallback, useEffect, useRef, useState } from "react";
import { FloatingBackground } from "./FloatingBackground";
import { PhotoFrame, type FrameTheme } from "./PhotoFrame";

type Step = "home" | "select" | "loading" | "shoot" | "done";

const EMPTY: (string | null)[] = [null, null, null, null];
const CAMERA_FILTER = "brightness(1.1) contrast(1.1) saturate(0.9) blur(0.5px)";
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
  const faceMeshRef = useRef<{
    send: (input: { image: HTMLVideoElement }) => Promise<void>;
    close: () => void;
    setOptions: (options: {
      maxNumFaces: number;
      refineLandmarks: boolean;
      minDetectionConfidence: number;
      minTrackingConfidence: number;
    }) => void;
    onResults: (cb: (results: { multiFaceLandmarks?: { x: number; y: number; z: number }[][] }) => void) => void;
  } | null>(null);
  const renderRafRef = useRef<number | null>(null);
  const detectTsRef = useRef(0);
  const detectBusyRef = useRef(false);
  const landmarksRef = useRef<{ x: number; y: number; z: number }[] | null>(null);
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
      ctx.drawImage(preview, sx, sy, sw, sh, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.92);
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
    ctx.filter = CAMERA_FILTER;
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
    ctx.restore();
    return c.toDataURL("image/jpeg", 0.92);
  }, [getCenterCropRect]);

  const drawBeautyWarpFrame = useCallback(() => {
    const video = videoRef.current;
    const preview = previewCanvasRef.current;
    if (!video || !preview || video.readyState < 2) return;

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;

    if (preview.width !== w || preview.height !== h) {
      preview.width = w;
      preview.height = h;
    }

    let work = workCanvasRef.current;
    if (!work) {
      work = document.createElement("canvas");
      workCanvasRef.current = work;
    }
    if (work.width !== w || work.height !== h) {
      work.width = w;
      work.height = h;
    }

    const ctx = preview.getContext("2d");
    const wctx = work.getContext("2d");
    if (!ctx || !wctx) return;

    // Base frame: mirror + beauty filter
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.filter = CAMERA_FILTER;
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();

    const now = performance.now();
    const faceMesh = faceMeshRef.current;
    if (faceMesh && !detectBusyRef.current && now - detectTsRef.current > 66) {
      detectBusyRef.current = true;
      detectTsRef.current = now;
      void faceMesh.send({ image: video }).finally(() => {
        detectBusyRef.current = false;
      });
    }

    const landmarks = landmarksRef.current;
    if (!landmarks) return;

    // Snapshot current frame for local warps.
    wctx.clearRect(0, 0, w, h);
    wctx.drawImage(preview, 0, 0, w, h);

    const p = (idx: number) => {
      const lm = landmarks[idx];
      return { x: (1 - lm.x) * w, y: lm.y * h };
    };

    const leftCheek = p(234);
    const rightCheek = p(454);
    const forehead = p(10);
    const chin = p(152);
    const faceCx = (leftCheek.x + rightCheek.x) * 0.5;
    const faceCy = (forehead.y + chin.y) * 0.5;
    const faceW = Math.max(40, Math.hypot(rightCheek.x - leftCheek.x, rightCheek.y - leftCheek.y));
    const faceH = Math.max(60, Math.abs(chin.y - forehead.y) * 1.1);
    const faceWidthRatio = faceW / w;

    // Device/camera FOV differs a lot between local and deployed mobile webviews.
    // Keep reshape conservative and adapt intensity when face occupies larger area.
    const slimStrength = faceWidthRatio > 0.4 ? 0.015 : faceWidthRatio > 0.33 ? 0.02 : 0.03;
    const eyeScale = faceWidthRatio > 0.4 ? 1.03 : faceWidthRatio > 0.33 ? 1.05 : 1.07;

    // V-line: softly squeeze face width while keeping center.
    const srcW = faceW * 1.04;
    const srcH = faceH * 1.02;
    const srcX = faceCx - srcW * 0.5;
    const srcY = faceCy - srcH * 0.5;
    const dstW = srcW * (1 - slimStrength);
    const dstX = faceCx - dstW * 0.5;

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(faceCx, faceCy, srcW * 0.47, srcH * 0.52, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalAlpha = 0.72;
    ctx.drawImage(work, srcX, srcY, srcW, srcH, dstX, srcY, dstW, srcH);
    ctx.restore();

    // Update snapshot after slim-face for eye enlargement pass.
    wctx.clearRect(0, 0, w, h);
    wctx.drawImage(preview, 0, 0, w, h);

    const eyeCenter = (a: number, b: number, c: number, d: number) => {
      const pa = p(a);
      const pb = p(b);
      const pc = p(c);
      const pd = p(d);
      return {
        x: (pa.x + pb.x + pc.x + pd.x) * 0.25,
        y: (pa.y + pb.y + pc.y + pd.y) * 0.25,
      };
    };

    const leftEye = eyeCenter(33, 133, 159, 145);
    const rightEye = eyeCenter(362, 263, 386, 374);
    const leftCornerA = p(33);
    const leftCornerB = p(133);
    const rightCornerA = p(362);
    const rightCornerB = p(263);
    const leftR = Math.max(8, Math.hypot(leftCornerA.x - leftCornerB.x, leftCornerA.y - leftCornerB.y) * 0.42);
    const rightR = Math.max(8, Math.hypot(rightCornerA.x - rightCornerB.x, rightCornerA.y - rightCornerB.y) * 0.42);

    const drawBigEye = (center: { x: number; y: number }, radius: number) => {
      const sx = center.x - radius;
      const sy = center.y - radius;
      const sw = radius * 2;
      const scale = eyeScale;
      const dw = sw * scale;
      const dx = center.x - dw * 0.5;
      const dy = center.y - dw * 0.5;

      ctx.save();
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius * 1.08, 0, Math.PI * 2);
      ctx.clip();
      ctx.globalAlpha = 0.82;
      ctx.drawImage(work!, sx, sy, sw, sw, dx, dy, dw, dw);
      ctx.restore();
    };

    drawBigEye(leftEye, leftR);
    drawBigEye(rightEye, rightR);
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
          video: { facingMode: "user" },
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
    let cancelled = false;
    (async () => {
      try {
        const { FaceMesh } = await import("@mediapipe/face_mesh");
        const faceMesh = new FaceMesh({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
        });
        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        faceMesh.onResults((results: { multiFaceLandmarks?: { x: number; y: number; z: number }[][] }) => {
          landmarksRef.current = results.multiFaceLandmarks?.[0] ?? null;
        });
        if (cancelled) {
          faceMesh.close();
          return;
        }
        faceMeshRef.current = faceMesh;
      } catch {
        faceMeshRef.current = null;
      }
    })();
    return () => {
      cancelled = true;
      landmarksRef.current = null;
      faceMeshRef.current?.close();
      faceMeshRef.current = null;
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
