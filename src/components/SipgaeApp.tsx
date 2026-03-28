"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FloatingBackground } from "./FloatingBackground";
import { BASIC_FRAME_SLOT_ASPECT, MUNGG_FRAME_SLOT_ASPECT, PhotoFrame, type FrameTheme } from "./PhotoFrame";
import { WebGLBeautyRenderer } from "./WebGLBeautyRenderer";

type Step = "home" | "select" | "loading" | "shoot" | "done";

const EMPTY: (string | null)[] = [null, null, null, null];
// Face Mesh landmark lerp smoothing factor (WebGL pipeline)
const LERP_S = 0.12;
const SMOOTHING_LERP = 0.15;
const HIGHKEY_FILTER = "brightness(1.22) contrast(1.14) saturate(1.10)";
const SHADOW_LIFT_ALPHA = 0.09;
const WHITE_OVERLAY_COLOR = "#f0f8ff";
const WHITE_OVERLAY_ALPHA = 0.07;
const JAW_SLIM_STRENGTH = 0.75;
const EYE_VERTICAL_STRETCH = 1.045;
const EYE_HORIZONTAL_STRETCH = 1.14;
const MIDFACE_COMPRESS = 0.94;
const SKIN_SMOOTH_BLUR_PX = 7.0;
const SKIN_SMOOTH_ALPHA = 0.82;
const SKIN_SMOOTH_GLOBAL_ALPHA = 0.28; // 전체 프레임 베이스 블러 (경계 완화용)
const EDGE_SHARPEN_CONTRAST = 1.30;
const CATCHLIGHT_ALPHA = 0;
const NOSE_SLIM_STRENGTH = 0.14;
const FACE_SLIM_STRENGTH = 0.26;
const ENABLE_EYE_STRETCH = true;
const ENABLE_EYE_SHARPEN = true;
const ENABLE_CATCHLIGHT = false;
const ENABLE_JAW_SLIM = true;
const ENABLE_MIDFACE_COMPRESS = true;
const ENABLE_NOSE_SLIM = true;
const ENABLE_FACE_SLIM = true;
const ENABLE_SKIN_SMOOTH = true;
// 진단용: true면 캔버스 렌더를 끄고 원본 비디오를 직접 표시
const DIAGNOSTIC_RAW_VIDEO_PREVIEW = false;
/** 모바일 프리뷰 CSS 줌아웃 비율 (캡처 사진에는 영향 없음) */
const MOBILE_ZOOM_SCALE = 0.70;
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

type Point = { x: number; y: number };
type FallbackFaceData = {
  bbox: { cx: number; cy: number; w: number; h: number };
  eyes: [Point, Point];
  nose: Point | null;
  mouth: Point | null;
};

const FACE_OVAL_INDICES = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
  148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
] as const;
const LEFT_EYE_RING = [33, 160, 158, 133, 153, 144] as const;
const RIGHT_EYE_RING = [362, 385, 387, 263, 373, 380] as const;
const BROW_NOSE_INDICES = [70, 63, 105, 66, 107, 300, 293, 334, 296, 336, 168, 6, 197, 195, 4] as const;
const JAW_LEFT_INDICES = [234, 172, 136, 150, 149, 176] as const;
const JAW_RIGHT_INDICES = [454, 397, 365, 379, 378, 400] as const;
// 코 날개 (좌: 캔버스 우측, 우: 캔버스 좌측 — 미러 기준)
const NOSE_WING_INDICES = [64, 129, 98, 294, 358, 327] as const;

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
  const rendererRef = useRef<WebGLBeautyRenderer | null>(null);
  // MediaPipe Face Mesh — 468+10 iris 랜드마크
  const faceMeshRef = useRef<unknown>(null);
  const faceMeshReadyRef = useRef(false);
  const faceMeshRunningRef = useRef(false);
  const lastFaceMeshMsRef = useRef(0);
  const landmarksRef = useRef<{ x: number; y: number; z: number }[] | null>(null);
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mpReadyRef = useRef(false);
  const mpFailedRef = useRef(false);
  const mpBusyRef = useRef(false);
  const lastMpMsRef = useRef(0);
  const mpLandmarksRef = useRef<Point[] | null>(null);
  const mpLandmarksSmoothRef = useRef<Point[] | null>(null);
  // fallback: FaceDetector
  const faceDetRef = useRef<unknown>(null);
  const lastDetectMsRef = useRef(0);
  const faceDataRef = useRef<FallbackFaceData | null>(null);
  const [isMobile, setIsMobile] = useState(false);

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

  const smoothPoints = useCallback((next: Point[], prev: Point[] | null, s: number) => {
    if (!prev || prev.length !== next.length) return next;
    return next.map((p, i) => ({
      x: prev[i].x * (1 - s) + p.x * s,
      y: prev[i].y * (1 - s) + p.y * s,
    }));
  }, []);

  const drawPolygonMask = useCallback((ctx: CanvasRenderingContext2D, points: Point[], indices: readonly number[]) => {
    if (!indices.length) return;
    const first = points[indices[0]];
    if (!first) return;
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < indices.length; i += 1) {
      const p = points[indices[i]];
      if (!p) continue;
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
  }, []);

  const getFallbackFaceData = useCallback(
    async (video: HTMLVideoElement, vw: number): Promise<FallbackFaceData | null> => {
      const now = Date.now();
      if (now - lastDetectMsRef.current <= 120 || !("FaceDetector" in window)) return faceDataRef.current;
      lastDetectMsRef.current = now;
      try {
        if (!faceDetRef.current) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          faceDetRef.current = new (window as any).FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const faces = await (faceDetRef.current as any).detect(video);
        if (!faces.length) {
          faceDataRef.current = null;
          return null;
        }
        const face = faces[0];
        const bb = face.boundingBox;
        const mx = (x: number) => vw - x;
        const bbox = { cx: mx(bb.x + bb.width / 2), cy: bb.y + bb.height / 2, w: bb.width, h: bb.height };
        type Lm = { type: string; locations: { x: number; y: number }[] };
        const lms: Lm[] = face.landmarks ?? [];
        const eyeLms = lms.filter((l) => l.type === "eye");
        const noseLm = lms.find((l) => l.type === "nose");
        const mouthLm = lms.find((l) => l.type === "mouth");
        const eyes: [Point, Point] =
          eyeLms.length >= 2
            ? [
                { x: mx(eyeLms[0].locations[0].x), y: eyeLms[0].locations[0].y },
                { x: mx(eyeLms[1].locations[0].x), y: eyeLms[1].locations[0].y },
              ]
            : [
                { x: mx(bb.x + bb.width * 0.28), y: bb.y + bb.height * 0.36 },
                { x: mx(bb.x + bb.width * 0.72), y: bb.y + bb.height * 0.36 },
              ];
        const nose = noseLm ? { x: mx(noseLm.locations[0].x), y: noseLm.locations[0].y } : null;
        const mouth = mouthLm ? { x: mx(mouthLm.locations[0].x), y: mouthLm.locations[0].y } : null;
        const prev = faceDataRef.current;
        const lerp = (a: number, b: number) => (prev ? a * (1 - SMOOTHING_LERP) + b * SMOOTHING_LERP : b);
        faceDataRef.current = {
          bbox: {
            cx: lerp(prev?.bbox.cx ?? bbox.cx, bbox.cx),
            cy: lerp(prev?.bbox.cy ?? bbox.cy, bbox.cy),
            w: lerp(prev?.bbox.w ?? bbox.w, bbox.w),
            h: lerp(prev?.bbox.h ?? bbox.h, bbox.h),
          },
          eyes: [
            { x: lerp(prev?.eyes[0].x ?? eyes[0].x, eyes[0].x), y: lerp(prev?.eyes[0].y ?? eyes[0].y, eyes[0].y) },
            { x: lerp(prev?.eyes[1].x ?? eyes[1].x, eyes[1].x), y: lerp(prev?.eyes[1].y ?? eyes[1].y, eyes[1].y) },
          ],
          nose: nose
            ? { x: lerp(prev?.nose?.x ?? nose.x, nose.x), y: lerp(prev?.nose?.y ?? nose.y, nose.y) }
            : null,
          mouth: mouth
            ? { x: lerp(prev?.mouth?.x ?? mouth.x, mouth.x), y: lerp(prev?.mouth?.y ?? mouth.y, mouth.y) }
            : null,
        };
      } catch {
        mpFailedRef.current = true;
      }
      return faceDataRef.current;
    },
    []
  );

  const captureFromVideo = useCallback(() => {
    const preview = previewCanvasRef.current;
    const c = canvasRef.current;
    const v = videoRef.current;
    if (!c) return null;

    const useBasicSlotAspect = theme === "basicBlack" || theme === "basicWhite";
    const isDailyEdition = theme === "dailyEditionDropout" || theme === "dailyEditionHomeGo";
    const aspect = useBasicSlotAspect
      ? BASIC_FRAME_SLOT_ASPECT
      : isDailyEdition
        ? MUNGG_FRAME_SLOT_ASPECT
        : SLOT_ASPECT;
    const capW = Math.round(CAPTURE_HEIGHT * aspect);
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
    ctx.filter = HIGHKEY_FILTER;
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
    ctx.restore();
    return c.toDataURL("image/jpeg", 0.95);
  }, [getCenterCropRect, theme]);

  const drawBeautyWarpFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;

    const preview = previewCanvasRef.current;
    if (!preview) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    // Always render in landscape (4:3) — crop center of portrait video
    let cropSx = 0, cropSy = 0, cropSw = vw, cropSh = vh;
    let pw = vw, ph = vh;
    const videoAspect = vw / vh;
    if (videoAspect < SLOT_ASPECT) {
      // Portrait or narrower than 4:3: crop height
      cropSh = Math.round(vw / SLOT_ASPECT);
      cropSy = Math.round((vh - cropSh) / 2);
      ph = cropSh;
    } else if (videoAspect > SLOT_ASPECT) {
      // Wider than 4:3: crop sides
      cropSw = Math.round(vh * SLOT_ASPECT);
      cropSx = Math.round((vw - cropSw) / 2);
      pw = cropSw;
    }

    if (preview.width !== pw || preview.height !== ph) {
      preview.width = pw;
      preview.height = ph;
    }

    let work = workCanvasRef.current;
    if (!work) {
      work = document.createElement("canvas");
      workCanvasRef.current = work;
    }
    if (work.width !== pw || work.height !== ph) {
      work.width = pw;
      work.height = ph;
    }

    const ctx = preview.getContext("2d");
    const wctx = work.getContext("2d");
    if (!ctx || !wctx) return;

    // Base pass: mirror + highkey (with landscape crop)
    wctx.clearRect(0, 0, pw, ph);
    wctx.save();
    wctx.filter = HIGHKEY_FILTER;
    wctx.translate(pw, 0);
    wctx.scale(-1, 1);
    wctx.drawImage(video, cropSx, cropSy, cropSw, cropSh, 0, 0, pw, ph);
    wctx.restore();
    ctx.clearRect(0, 0, pw, ph);
    ctx.drawImage(work, 0, 0);

    // Tone pass: shadow lift + white overlay
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = SHADOW_LIFT_ALPHA;
    ctx.fillStyle = WHITE_OVERLAY_COLOR;
    ctx.fillRect(0, 0, pw, ph);
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = "soft-light";
    ctx.globalAlpha = WHITE_OVERLAY_ALPHA;
    ctx.fillStyle = WHITE_OVERLAY_COLOR;
    ctx.fillRect(0, 0, pw, ph);
    ctx.restore();

    // Run MediaPipe at low frequency
    if (mpReadyRef.current && !mpFailedRef.current && !mpBusyRef.current && Date.now() - lastMpMsRef.current > 70) {
      mpBusyRef.current = true;
      lastMpMsRef.current = Date.now();
      try {
        const mesh = faceMeshRef.current as { send?: (input: { image: HTMLVideoElement }) => Promise<void> } | null;
        if (mesh?.send) {
          await mesh.send({ image: video });
        }
      } catch {
        mpFailedRef.current = true;
      } finally {
        mpBusyRef.current = false;
      }
    }

    const lm = mpLandmarksSmoothRef.current;
    if (ENABLE_SKIN_SMOOTH && lm && lm.length >= 468) {
      // Adjust landmarks to canvas coordinate space (offset by crop)
      const adjLm = (cropSx === 0 && cropSy === 0)
        ? lm
        : lm.map((p) => ({ x: p.x - cropSx, y: p.y - cropSy }));

      // Geometry pass: jaw line refine
      wctx.clearRect(0, 0, pw, ph);
      wctx.drawImage(preview, 0, 0);
      const chin = adjLm[152];
      if (chin && ENABLE_JAW_SLIM) {
        const pullOne = (p: Point, dir: -1 | 1) => {
          const r = Math.max(6, pw * 0.02);
          ctx.save();
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.clip();
          ctx.globalAlpha = 0.26;
          const dx = Math.abs(p.x - chin.x) * JAW_SLIM_STRENGTH * dir;
          ctx.drawImage(work, p.x - r, p.y - r, r * 2, r * 2, p.x - r - dx, p.y - r, r * 2, r * 2);
          ctx.restore();
        };
        JAW_LEFT_INDICES.forEach((idx) => {
          const p = adjLm[idx];
          if (p) pullOne(p, 1);
        });
        JAW_RIGHT_INDICES.forEach((idx) => {
          const p = adjLm[idx];
          if (p) pullOne(p, -1);
        });
      }

      // Geometry pass: eye vertical micro stretch
      wctx.clearRect(0, 0, pw, ph);
      wctx.drawImage(preview, 0, 0);
      const stretchEye = (ring: readonly number[]) => {
        const pts = ring.map((idx) => adjLm[idx]).filter(Boolean) as Point[];
        if (!pts.length) return;
        const cx = pts.reduce((acc, p) => acc + p.x, 0) / pts.length;
        const cy = pts.reduce((acc, p) => acc + p.y, 0) / pts.length;
        const radius = Math.max(10, Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy))) * 1.25);
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.clip();
        ctx.translate(cx, cy);
        ctx.scale(EYE_HORIZONTAL_STRETCH, EYE_VERTICAL_STRETCH);
        ctx.translate(-cx, -cy);
        ctx.globalAlpha = 0.6;
        ctx.drawImage(work, cx - radius, cy - radius, radius * 2, radius * 2, cx - radius, cy - radius, radius * 2, radius * 2);
        ctx.restore();
      };
      if (ENABLE_EYE_STRETCH) {
        stretchEye(LEFT_EYE_RING);
        stretchEye(RIGHT_EYE_RING);
      }

      // Geometry pass: full face cheek slimming
      if (ENABLE_FACE_SLIM) {
        wctx.clearRect(0, 0, pw, ph);
        wctx.drawImage(preview, 0, 0);
        const faceLeft = adjLm[234];
        const faceRight = adjLm[454];
        const foreheadPt = adjLm[10];
        const chinPt = adjLm[152];
        if (faceLeft && faceRight && foreheadPt && chinPt) {
          const faceCenterX = (faceLeft.x + faceRight.x) / 2;
          const faceTopY = foreheadPt.y;
          const faceBotY = chinPt.y;
          const r = Math.max(8, pw * 0.028);
          FACE_OVAL_INDICES.forEach((idx) => {
            const p = adjLm[idx];
            if (!p) return;
            const yRatio = (p.y - faceTopY) / (faceBotY - faceTopY);
            if (yRatio < 0.15 || yRatio > 0.90) return;
            const gradient = Math.sin(yRatio * Math.PI) * 0.6 + 0.4;
            const distFromCenter = p.x - faceCenterX;
            if (Math.abs(distFromCenter) < pw * 0.008) return;
            const dir: 1 | -1 = distFromCenter > 0 ? 1 : -1;
            const dx = Math.abs(distFromCenter) * FACE_SLIM_STRENGTH * gradient * dir;
            ctx.save();
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.clip();
            ctx.globalAlpha = 0.32;
            ctx.drawImage(work, p.x - r, p.y - r, r * 2, r * 2, p.x - r - dx, p.y - r, r * 2, r * 2);
            ctx.restore();
          });
        }
      }

      // Geometry pass: mid-face compression (코~윗입술 세로 축소)
      const noseTip = adjLm[1];
      const upperLip = adjLm[13];
      if (noseTip && upperLip && ENABLE_MIDFACE_COMPRESS) {
        wctx.clearRect(0, 0, pw, ph);
        wctx.drawImage(preview, 0, 0);
        const cx = (noseTip.x + upperLip.x) * 0.5;
        const cy = (noseTip.y + upperLip.y) * 0.5;
        const faceW = Math.abs(adjLm[454].x - adjLm[234].x);
        const zoneW = faceW * 0.46;
        const zoneH = Math.max(14, Math.abs(upperLip.y - noseTip.y) * 3.0);
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(cx, cy, zoneW, zoneH, 0, 0, Math.PI * 2);
        ctx.clip();
        ctx.globalAlpha = 0.72;
        ctx.drawImage(work, cx - zoneW, cy - zoneH, zoneW * 2, zoneH * 2, cx - zoneW, cy - zoneH * MIDFACE_COMPRESS, zoneW * 2, zoneH * 2 * MIDFACE_COMPRESS);
        ctx.restore();
      }

      // Geometry pass: nose narrowing
      if (ENABLE_NOSE_SLIM && adjLm[1]) {
        wctx.clearRect(0, 0, pw, ph);
        wctx.drawImage(preview, 0, 0);
        const noseCenterX = adjLm[1].x;
        const r = Math.max(7, pw * 0.022);
        NOSE_WING_INDICES.forEach((idx) => {
          const p = adjLm[idx];
          if (!p) return;
          const dir: 1 | -1 = p.x > noseCenterX ? 1 : -1;
          const dx = Math.abs(p.x - noseCenterX) * NOSE_SLIM_STRENGTH * dir;
          ctx.save();
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.clip();
          ctx.globalAlpha = 0.38;
          ctx.drawImage(work, p.x - r, p.y - r, r * 2, r * 2, p.x - r - dx, p.y - r, r * 2, r * 2);
          ctx.restore();
        });
      }

      // Texture pass: 1단계 — 전체 프레임 베이스 블러 (얼굴 경계 완화)
      wctx.clearRect(0, 0, pw, ph);
      wctx.drawImage(preview, 0, 0);
      ctx.save();
      ctx.filter = `blur(${SKIN_SMOOTH_BLUR_PX * 0.5}px)`;
      ctx.globalAlpha = SKIN_SMOOTH_GLOBAL_ALPHA;
      ctx.drawImage(work, 0, 0, pw, ph);
      ctx.restore();
      // Texture pass: 2단계 — 얼굴 내부 추가 스무딩
      wctx.clearRect(0, 0, pw, ph);
      wctx.drawImage(preview, 0, 0);
      ctx.save();
      drawPolygonMask(ctx, adjLm, FACE_OVAL_INDICES);
      ctx.clip();
      ctx.filter = `blur(${SKIN_SMOOTH_BLUR_PX}px)`;
      ctx.globalAlpha = SKIN_SMOOTH_ALPHA;
      ctx.drawImage(work, 0, 0, pw, ph);
      ctx.restore();
      // Preserve eye texture by restoring original eye neighborhoods.
      const restoreEyePatch = (ring: readonly number[]) => {
        const pts = ring.map((idx) => adjLm[idx]).filter(Boolean) as Point[];
        if (!pts.length) return;
        const cx = pts.reduce((acc, p) => acc + p.x, 0) / pts.length;
        const cy = pts.reduce((acc, p) => acc + p.y, 0) / pts.length;
        const radius = Math.max(12, Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy))) * 1.55);
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.clip();
        ctx.globalAlpha = 1;
        ctx.drawImage(work, cx - radius, cy - radius, radius * 2, radius * 2, cx - radius, cy - radius, radius * 2, radius * 2);
        ctx.restore();
      };
      restoreEyePatch(LEFT_EYE_RING);
      restoreEyePatch(RIGHT_EYE_RING);

      // Texture pass: eyes/brows/nose edge sharpen
      wctx.clearRect(0, 0, pw, ph);
      wctx.drawImage(preview, 0, 0);
      const sharpenLocal = (p: Point, radius: number, alpha = 0.25) => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.clip();
        ctx.filter = `contrast(${EDGE_SHARPEN_CONTRAST})`;
        ctx.globalAlpha = alpha;
        ctx.drawImage(work, p.x - radius, p.y - radius, radius * 2, radius * 2, p.x - radius, p.y - radius, radius * 2, radius * 2);
        ctx.restore();
      };
      if (ENABLE_EYE_SHARPEN) {
        [33, 133, 362, 263].forEach((idx) => {
          const p = adjLm[idx];
          if (p) sharpenLocal(p, Math.max(6, pw * 0.009), 0.1);
        });
        BROW_NOSE_INDICES.forEach((idx) => {
          const p = adjLm[idx];
          if (p) sharpenLocal(p, Math.max(6, pw * 0.009), 0.12);
        });
      }

      // Finish pass: catchlight (iris indices 468-477 if available)
      const drawCatchlight = (p: Point) => {
        if (CATCHLIGHT_ALPHA <= 0 || !ENABLE_CATCHLIGHT) return;
        const r = Math.max(0.8, pw * 0.0016);
        ctx.save();
        ctx.fillStyle = "#ffffff";
        ctx.globalAlpha = CATCHLIGHT_ALPHA;
        ctx.beginPath();
        ctx.arc(p.x - r * 1.15, p.y - r * 1.55, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };
      if (adjLm.length >= 478) {
        const leftIris = adjLm.slice(468, 473);
        const rightIris = adjLm.slice(473, 478);
        const center = (iris: Point[]) => ({
          x: iris.reduce((acc, p) => acc + p.x, 0) / iris.length,
          y: iris.reduce((acc, p) => acc + p.y, 0) / iris.length,
        });
        drawCatchlight(center(leftIris));
        drawCatchlight(center(rightIris));
      }
      return;
    }

    // fallback path: FaceDetector minimal touch-up
    const fallback = await getFallbackFaceData(video, vw);
    if (!fallback) return;
    wctx.clearRect(0, 0, pw, ph);
    wctx.drawImage(preview, 0, 0);
    const eyeR = fallback.bbox.w * 0.08;
    const drawFallbackCatchlight = (ex: number, ey: number) => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(ex - eyeR * 0.2, ey - eyeR * 0.2, Math.max(1.4, eyeR * 0.12), 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = CATCHLIGHT_ALPHA;
      ctx.fill();
      ctx.restore();
    };
    drawFallbackCatchlight(fallback.eyes[0].x - cropSx, fallback.eyes[0].y - cropSy);
    drawFallbackCatchlight(fallback.eyes[1].x - cropSx, fallback.eyes[1].y - cropSy);
  }, [drawPolygonMask, getFallbackFaceData]);

  useEffect(() => {
    setIsMobile(/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768);
  }, []);

  useEffect(() => {
    if (step !== "shoot") {
      mpReadyRef.current = false;
      mpBusyRef.current = false;
      mpLandmarksRef.current = null;
      mpLandmarksSmoothRef.current = null;
      if (faceMeshRef.current && typeof (faceMeshRef.current as { close?: () => void }).close === "function") {
        (faceMeshRef.current as { close: () => void }).close();
      }
      faceMeshRef.current = null;
      return;
    }

    let cancelled = false;
    mpFailedRef.current = false;
    (async () => {
      try {
        const { FaceMesh } = await import("@mediapipe/face_mesh");
        const mesh = new FaceMesh({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
        });
        mesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.6,
          minTrackingConfidence: 0.6,
        });
        mesh.onResults((results: { multiFaceLandmarks?: { x: number; y: number }[][] }) => {
          if (cancelled) return;
          const raw = results.multiFaceLandmarks?.[0];
          if (!raw?.length) {
            mpLandmarksRef.current = null;
            mpLandmarksSmoothRef.current = null;
            return;
          }
          const mirrored = raw.map((p) => ({ x: (1 - p.x) * (videoRef.current?.videoWidth ?? 1), y: p.y * (videoRef.current?.videoHeight ?? 1) }));
          mpLandmarksRef.current = mirrored;
          mpLandmarksSmoothRef.current = smoothPoints(mirrored, mpLandmarksSmoothRef.current, SMOOTHING_LERP);
        });
        if (cancelled) {
          mesh.close();
          return;
        }
        faceMeshRef.current = mesh;
        mpReadyRef.current = true;
      } catch {
        mpFailedRef.current = true;
        mpReadyRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
      mpReadyRef.current = false;
      mpBusyRef.current = false;
      mpLandmarksRef.current = null;
      mpLandmarksSmoothRef.current = null;
      if (faceMeshRef.current && typeof (faceMeshRef.current as { close?: () => void }).close === "function") {
        (faceMeshRef.current as { close: () => void }).close();
      }
      faceMeshRef.current = null;
    };
  }, [smoothPoints, step]);

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
          video: { facingMode: "user", width: { ideal: 1920, min: 1280 }, height: { ideal: 1080, min: 720 }, aspectRatio: { ideal: 16 / 9 } },
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
    if (DIAGNOSTIC_RAW_VIDEO_PREVIEW) return;
    let stopped = false;
    const loop = () => {
      if (stopped) return;
      void drawBeautyWarpFrame();
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
  // previewCanvasRef는 2D 컨텍스트(drawBeautyWarpFrame)가 사용하므로,
  // WebGL 렌더러는 별도 오프스크린 캔버스에 초기화해야 충돌을 방지.
  useEffect(() => {
    if (step !== "shoot") return;
    const offscreen = document.createElement("canvas");
    let renderer: WebGLBeautyRenderer;
    try {
      renderer = new WebGLBeautyRenderer(offscreen);
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
              style={
                DIAGNOSTIC_RAW_VIDEO_PREVIEW
                  ? {
                      width: "100vw",
                      height: "100vh",
                      objectFit: "cover",
                      transform: "scaleX(-1)",
                      filter: "none",
                    }
                  : { position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }
              }
            />
            <canvas
              ref={previewCanvasRef}
              className="shoot-canvas"
              style={
                DIAGNOSTIC_RAW_VIDEO_PREVIEW
                  ? { display: "none" }
                  : {
                      width: "min(100vw, calc(100vh * 4 / 3))",
                      height: "auto",
                      aspectRatio: "4 / 3",
                      position: "relative",
                      zIndex: 2,
                      ...(isMobile && {
                        transform: `scale(${MOBILE_ZOOM_SCALE})`,
                        transformOrigin: "center center",
                      }),
                    }
              }
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
                zIndex: 3,
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
                  zIndex: 4,
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
