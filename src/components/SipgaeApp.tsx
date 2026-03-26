"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FloatingBackground } from "./FloatingBackground";
import { BASIC_FRAME_SLOT_ASPECT, PhotoFrame, type FrameTheme } from "./PhotoFrame";

type Step = "home" | "select" | "loading" | "shoot" | "done";

const EMPTY: (string | null)[] = [null, null, null, null];
// 포토이즘 필터: 가장 '뽀얀' 느낌의 조합
const CAMERA_FILTER    = "contrast(1.1) brightness(1.1) saturate(1.05) blur(0.3px)";
const BEAUTY_SLIM      = 0.97;   // V-line: 3 % 가로 압축 (자연스러운 슬림)
const BEAUTY_EYE_ZOOM  = 1.05;   // 눈 5 % 확대
const BEAUTY_EYE_ALPHA = 0.84;
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
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // FaceDetector (Chrome/Edge only) — Safari에선 눈·중안부 보정 스킵
  const faceDetRef = useRef<unknown>(null);
  const lastDetectMsRef = useRef(0);
  // 검출된 얼굴 데이터 캐시 (미러 좌표계)
  const faceDataRef = useRef<{
    bbox: { cx: number; cy: number; w: number; h: number };
    eyes: [{ x: number; y: number }, { x: number; y: number }];
    nose: { x: number; y: number } | null;
    mouth: { x: number; y: number } | null;
  } | null>(null);

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
    // Preview is mirrored; capture must preserve the same mirror orientation.
    // Filter is applied at draw time so saved frame keeps the same look.
    ctx.save();
    ctx.filter = CAMERA_FILTER;
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
    ctx.restore();
    return c.toDataURL("image/jpeg", 0.95);
  }, [getCenterCropRect, theme]);

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

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    wctx.imageSmoothingEnabled = true;
    wctx.imageSmoothingQuality = "high";

    // ── Pass 1: 좌우 반전 + 포토이즘 필터 → work ─────────────────────────
    wctx.save();
    wctx.clearRect(0, 0, vw, vh);
    wctx.filter = CAMERA_FILTER;
    wctx.translate(vw, 0);
    wctx.scale(-1, 1);
    wctx.drawImage(video, 0, 0, vw, vh);
    wctx.restore();

    // ── Pass 2: V-line 슬림 (얼굴 중심 기준 scale 0.97x) ────────────────
    // FaceDetector 사용 가능하면 검출된 얼굴 중심, 아니면 프레임 중심
    const fcx = faceDataRef.current?.bbox.cx ?? vw / 2;
    const leftGap  = Math.ceil(fcx * (1 - BEAUTY_SLIM));
    const rightGap = Math.ceil((vw - fcx) * (1 - BEAUTY_SLIM));
    ctx.clearRect(0, 0, vw, vh);
    ctx.save();
    ctx.translate(fcx, 0);
    ctx.scale(BEAUTY_SLIM, 1);
    ctx.translate(-fcx, 0);
    ctx.drawImage(work, 0, 0, vw, vh);
    ctx.restore();
    // 가장자리 빈 공간 채움
    if (leftGap > 0)  ctx.drawImage(work, 0, 0, 1, vh, 0, 0, leftGap + 1, vh);
    if (rightGap > 0) ctx.drawImage(work, vw - 1, 0, 1, vh, vw - rightGap - 1, 0, rightGap + 1, vh);

    // ── Pass 3: 피치-핑크 soft-light 오버레이 (포토이즘 피부 색감) ─────────
    ctx.save();
    ctx.globalCompositeOperation = "soft-light";
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = "#FFCBA4";
    ctx.fillRect(0, 0, vw, vh);
    ctx.restore();

    // ── FaceDetector 비동기 갱신 (120 ms 쓰로틀) ─────────────────────────
    const now = Date.now();
    if (now - lastDetectMsRef.current > 120 && "FaceDetector" in window) {
      lastDetectMsRef.current = now;
      (async () => {
        try {
          if (!faceDetRef.current) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            faceDetRef.current = new (window as any).FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const faces = await (faceDetRef.current as any).detect(video);
          if (!faces.length) { faceDataRef.current = null; return; }

          const face = faces[0];
          const bb   = face.boundingBox;
          // 미러 좌표 변환 헬퍼
          const mx = (x: number) => vw - x;

          // bbox (미러)
          const bbox = {
            cx: mx(bb.x + bb.width / 2),
            cy: bb.y + bb.height / 2,
            w: bb.width,
            h: bb.height,
          };

          // 랜드마크 파싱
          type Lm = { type: string; locations: { x: number; y: number }[] };
          const lms: Lm[] = face.landmarks ?? [];
          const eyeLms  = lms.filter((l) => l.type === "eye");
          const noseLm  = lms.find((l) => l.type === "nose");
          const mouthLm = lms.find((l) => l.type === "mouth");

          let eyes: [{ x: number; y: number }, { x: number; y: number }];
          if (eyeLms.length >= 2) {
            eyes = [
              { x: mx(eyeLms[0].locations[0].x), y: eyeLms[0].locations[0].y },
              { x: mx(eyeLms[1].locations[0].x), y: eyeLms[1].locations[0].y },
            ];
          } else {
            eyes = [
              { x: mx(bb.x + bb.width * 0.28), y: bb.y + bb.height * 0.36 },
              { x: mx(bb.x + bb.width * 0.72), y: bb.y + bb.height * 0.36 },
            ];
          }

          const nose  = noseLm  ? { x: mx(noseLm.locations[0].x),  y: noseLm.locations[0].y  } : null;
          const mouth = mouthLm ? { x: mx(mouthLm.locations[0].x), y: mouthLm.locations[0].y } : null;

          // lerp 스무딩으로 jitter 방지
          const prev = faceDataRef.current;
          const s = 0.28;
          const lerp = (a: number, b: number) => prev ? a * (1 - s) + b * s : b;
          faceDataRef.current = {
            bbox: {
              cx: lerp(prev?.bbox.cx ?? bbox.cx, bbox.cx),
              cy: lerp(prev?.bbox.cy ?? bbox.cy, bbox.cy),
              w:  lerp(prev?.bbox.w  ?? bbox.w,  bbox.w),
              h:  lerp(prev?.bbox.h  ?? bbox.h,  bbox.h),
            },
            eyes: [
              { x: lerp(prev?.eyes[0].x ?? eyes[0].x, eyes[0].x), y: lerp(prev?.eyes[0].y ?? eyes[0].y, eyes[0].y) },
              { x: lerp(prev?.eyes[1].x ?? eyes[1].x, eyes[1].x), y: lerp(prev?.eyes[1].y ?? eyes[1].y, eyes[1].y) },
            ],
            nose:  nose  ? { x: lerp(prev?.nose?.x  ?? nose.x,  nose.x),  y: lerp(prev?.nose?.y  ?? nose.y,  nose.y)  } : null,
            mouth: mouth ? { x: lerp(prev?.mouth?.x ?? mouth.x, mouth.x), y: lerp(prev?.mouth?.y ?? mouth.y, mouth.y) } : null,
          };
        } catch { /* ignore */ }
      })();
    }

    // ── FaceDetector 데이터가 있을 때만 적용되는 보정 ─────────────────────
    const fd = faceDataRef.current;
    if (!fd) return;

    // work ← 현재 preview 스냅샷
    wctx.clearRect(0, 0, vw, vh);
    wctx.drawImage(preview, 0, 0);

    // ── Pass 4: 중안부 축소 (코 좌표 기준 인중 위로 당기기) ──────────────
    if (fd.nose) {
      const noseY  = fd.nose.y;
      const faceW  = fd.bbox.w;
      const faceH  = fd.bbox.h;
      const zoneTop = noseY - faceH * 0.08;
      const zoneBot = noseY + faceH * 0.22;
      const zoneH   = zoneBot - zoneTop;
      const dstH    = zoneH * 0.96;   // 4 % 세로 압축
      const shift   = zoneH * 0.04;   // 위로 시프트

      ctx.save();
      ctx.beginPath();
      ctx.ellipse(fd.bbox.cx, noseY + faceH * 0.07, faceW * 0.28, zoneH * 0.46, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.globalAlpha = 0.72;
      ctx.drawImage(
        work,
        fd.bbox.cx - faceW * 0.28, zoneTop,          faceW * 0.56, zoneH,
        fd.bbox.cx - faceW * 0.28, zoneTop - shift,   faceW * 0.56, dstH,
      );
      ctx.restore();

      // work 갱신
      wctx.clearRect(0, 0, vw, vh);
      wctx.drawImage(preview, 0, 0);
    }

    // ── Pass 5: 눈 확대 (얼굴폭 * 0.1 반경, magnify) ─────────────────────
    const eyeR    = fd.bbox.w * 0.10;
    const srcSide = eyeR * 2;
    const dstSide = srcSide * BEAUTY_EYE_ZOOM;

    const enlargeEye = (ex: number, ey: number) => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(ex, ey, eyeR * 0.88, 0, Math.PI * 2);
      ctx.clip();
      ctx.globalAlpha = BEAUTY_EYE_ALPHA;
      ctx.drawImage(work, ex - eyeR, ey - eyeR, srcSide, srcSide, ex - dstSide / 2, ey - dstSide / 2, dstSide, dstSide);
      ctx.restore();
    };

    enlargeEye(fd.eyes[0].x, fd.eyes[0].y);
    enlargeEye(fd.eyes[1].x, fd.eyes[1].y);

    // ── Pass 6: 캐치라이트 (눈에 생기 도트) ──────────────────────────────
    const clR = Math.max(2, eyeR * 0.07);
    const drawCatchlight = (ex: number, ey: number) => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(ex - eyeR * 0.15, ey - eyeR * 0.28, clR, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 0.60;
      ctx.fill();
      ctx.restore();
    };

    drawCatchlight(fd.eyes[0].x, fd.eyes[0].y);
    drawCatchlight(fd.eyes[1].x, fd.eyes[1].y);
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
                filter: "drop-shadow(0 6px 16px rgba(90, 60, 120, 0.15))",
                marginBottom: -36,
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
              일상을 소중하개
            </p>
            <p style={{ fontSize: "0.93rem", color: "#756687", opacity: 0.95, lineHeight: 1.6 }}>
              여러분의 일상을 네컷으로 담아보세요
            </p>
            <button
              type="button"
              onClick={() => setStep("select")}
              style={{
                position: "relative",
                zIndex: 1,
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
                <p style={{ fontSize: "0.82rem", color: "#6d5b88", marginBottom: 10 }}>멍개 프레임</p>
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
                    border: "1px solid rgba(90,60,140,0.28)",
                    background: "rgba(255,255,255,0.72)",
                    cursor: "pointer",
                    fontSize: "1.1rem",
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
                    borderRadius: 14,
                    border:
                      selectedTheme === currentDailyEditionTheme.id
                        ? "2px solid #6f56b5"
                        : "2px solid transparent",
                    background:
                      selectedTheme === currentDailyEditionTheme.id
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
                    border: "1px solid rgba(90,60,140,0.28)",
                    background: "rgba(255,255,255,0.72)",
                    cursor: "pointer",
                    fontSize: "1.1rem",
                  }}
                  aria-label="다음 멍개 프레임"
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

export default SipgaeApp;
