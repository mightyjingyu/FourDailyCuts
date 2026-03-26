/**
 * WebGLBeautyRenderer
 * GPU-only beauty pipeline (WebGL2)
 *
 * Pipeline:
 *   Pass 1  – video → fboSharp : mirror + unsharp-mask + contrast + brightness
 *   Pass 2H – fboSharp → fboH  : 7-tap Gaussian (horizontal, r=8px) → bloom blur
 *   Pass 2V – fboH     → fboV  : 7-tap Gaussian (vertical,   r=8px) → bloom blur
 *   Pass 3  – fboSharp + fboV → canvas : bloom(screen) + vignette + face-oval softening
 */

// ─── 3-D LUT ─────────────────────────────────────────────────────────────────
const LUT_N = 32; // 32³ colour grid

/**
 * Photoism "Natural Cool-Tone" LUT
 * 무보정인 듯 자연스러운 쿨톤 — 창백함 → 투명함
 * • R  +3.0 %  (피부 생기·화사함 회복)
 * • G  +5.0 %  (밝기·화사함 유지)
 * • B  +4→6.5 %  (x² 커브, 하이라이트 집중 — 차가움 완화)
 * • Shadow lift +1.5 %
 * • 5 % 탈채도
 */
function buildPhotoismLUT(): Uint8Array {
  const data = new Uint8Array(LUT_N * LUT_N * LUT_N * 4);

  /** Gentle S-curve */
  const sc = (x: number) =>
    x + Math.sin(x * Math.PI) * (x < 0.5 ? 0.04 : -0.04);

  // R/G/B 동일 — 색감 없음, 밝기만 살짝 올림
  const R = (x: number) => sc(Math.min(1, x * 1.04));
  const G = (x: number) => sc(Math.min(1, x * 1.04));
  const B = (x: number) => sc(Math.min(1, x * 1.04));

  for (let b = 0; b < LUT_N; b++) {
    for (let g = 0; g < LUT_N; g++) {
      for (let r = 0; r < LUT_N; r++) {
        // Shadow lift 0 → 순수 블랙 유지 (눈동자·머리카락 디테일 살림)
        const ri = R(r / (LUT_N - 1));
        const gi = G(g / (LUT_N - 1));
        const bi = B(b / (LUT_N - 1));

        const idx = (b * LUT_N * LUT_N + g * LUT_N + r) * 4;
        data[idx + 0] = Math.round(Math.min(1, Math.max(0, ri)) * 255);
        data[idx + 1] = Math.round(Math.min(1, Math.max(0, gi)) * 255);
        data[idx + 2] = Math.round(Math.min(1, Math.max(0, bi)) * 255);
        data[idx + 3] = 255;
      }
    }
  }
  return data;
}

// ─── GLSL shaders ─────────────────────────────────────────────────────────────

/** Shared vertex shader — layout locations are fixed across all programs */
const VERT = /* glsl */ `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in vec2 a_uv;
out vec2 v_uv;
void main(){gl_Position=vec4(a_pos,0.,1.);v_uv=a_uv;}`;

/**
 * Pass 1 – Mirror + 3-D LUT colour grade
 * UV convention: no UNPACK_FLIP_Y → UV(0,0) = top-left of video frame.
 * Mirror: flip X only.  Y stays unchanged.
 */
const FRAG_LUT = /* glsl */ `#version 300 es
precision mediump float;
precision mediump sampler3D;
uniform sampler2D u_video;
uniform sampler3D u_lut;
in  vec2 v_uv;
out vec4 o;
vec3 lut(vec3 c){
  const float N=${LUT_N}.;
  return texture(u_lut,clamp(c,0.,1.)*(N-1.)/N+.5/N).rgb;
}
void main(){
  vec2 uv=vec2(1.-v_uv.x,1.-v_uv.y);
  vec3 col=texture(u_video,uv).rgb;

  // ── Unsharp Mask (5-tap cross, strength 2.5) ─────────────────────────────
  vec2 px=1.0/vec2(textureSize(u_video,0));
  vec3 nbr=(
    texture(u_video,uv+vec2( px.x, 0.)).rgb+
    texture(u_video,uv+vec2(-px.x, 0.)).rgb+
    texture(u_video,uv+vec2( 0., px.y)).rgb+
    texture(u_video,uv+vec2( 0.,-px.y)).rgb
  )*0.25;
  col=clamp(col+(col-nbr)*3.0,0.,1.);

  // ── Tone Curve: contrast(1.12) → brightness(1.15) ────────────────────────
  col=(col-0.5)*1.12+0.5;
  col*=1.15;

  // ── 채도 -15% (전체 색감 차분하게) ──────────────────────────────────────
  float luma=dot(col,vec3(0.299,0.587,0.114));
  col=mix(vec3(luma),col,0.85);

  // ── 색선명도 Vibrance +0.30 (낮은 채도 영역 집중 부스트) ─────────────
  // 이미 채도 높은 색은 건드리지 않고, 낮은 채도 색만 살려줌
  float sat=max(col.r,max(col.g,col.b))-min(col.r,min(col.g,col.b));
  col=mix(vec3(luma),col,1.0+(1.0-sat)*0.30);

  o=vec4(clamp(col,0.,1.),1.);
}`;

/**
 * Pass 2 – Separable 7-tap Gaussian (reused for H and V by changing u_dir)
 * Weights for σ ≈ 1.5; u_dir carries the per-texel offset in UV units.
 */
const FRAG_BLUR = /* glsl */ `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_dir;
in  vec2 v_uv;
out vec4 o;
void main(){
  vec3 s =texture(u_tex,v_uv        ).rgb*0.2270270;
  s+=texture(u_tex,v_uv+u_dir*1.).rgb*0.1945946;
  s+=texture(u_tex,v_uv-u_dir*1.).rgb*0.1945946;
  s+=texture(u_tex,v_uv+u_dir*2.).rgb*0.1216216;
  s+=texture(u_tex,v_uv-u_dir*2.).rgb*0.1216216;
  s+=texture(u_tex,v_uv+u_dir*3.).rgb*0.0540540;
  s+=texture(u_tex,v_uv-u_dir*3.).rgb*0.0540540;
  o=vec4(s,1.);
}`;

/**
 * Pass 3 – Composite: blend sharp with softened using MediaPipe face-oval ellipse.
 * u_fc / u_fr are in display-UV space (already mirror-adjusted in JS).
 * smoothstep gives a feathered edge so no hard ring artefacts.
 */
const FRAG_COMP = /* glsl */ `#version 300 es
precision mediump float;
uniform sampler2D u_sharp;
uniform sampler2D u_soft;   // wide-blur (r=8px) — bloom source
uniform bool  u_hasFace;
uniform vec2  u_fc;
uniform vec2  u_fr;
in  vec2 v_uv;
out vec4 o;

float faceMask(vec2 uv){
  if(!u_hasFace)return 0.;
  vec2 d=(uv-u_fc)/u_fr;
  return smoothstep(1.35,.65,length(d));
}

void main(){
  vec3 sharp  =texture(u_sharp,v_uv).rgb;
  vec3 blurred=texture(u_soft, v_uv).rgb;

  // ── Bloom (하이라이트 영역만 추출 → screen blend) ─────────────────────
  // 루마 기준 0.60 이상인 밝은 영역만 블룸 대상
  float luma=dot(blurred,vec3(0.299,0.587,0.114));
  const float THRESH=0.60;
  float hi=smoothstep(THRESH,1.0,luma);          // 부드러운 하이라이트 마스크
  vec3  bloom=blurred*hi*0.45;                   // 블룸 강도 0.45
  // Screen blend: 1-(1-a)(1-b)
  vec3 result=1.-(1.-sharp)*(1.-bloom);

  // ── Face skin softening (25%, 뽀샤시 미세하게) ───────────────────────
  float m=faceMask(v_uv);
  result=mix(result,mix(result,blurred,0.25),m);

  // ── Vignette (가장자리 최대 18% 어둡게 → 시선 집중) ─────────────────
  vec2  cv   =v_uv-0.5;
  float vdist=dot(cv,cv);                        // 0 at centre, 0.5 at corner
  float vig  =1.-smoothstep(0.18,0.50,vdist)*0.18;
  result*=vig;

  o=vec4(clamp(result,0.,1.),1.);
}`;

// ─── helpers ──────────────────────────────────────────────────────────────────

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  src: string
): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error("Shader compile error:\n" + gl.getShaderInfoLog(s));
  return s;
}

function linkProg(
  gl: WebGL2RenderingContext,
  vs: string,
  fs: string
): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error("Program link error:\n" + gl.getProgramInfoLog(p));
  return p;
}

type FBO = { fb: WebGLFramebuffer; tex: WebGLTexture };

function makeFBO(gl: WebGL2RenderingContext, w: number, h: number): FBO {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return { fb, tex };
}

function deleteFBO(gl: WebGL2RenderingContext, fbo: FBO) {
  gl.deleteFramebuffer(fbo.fb);
  gl.deleteTexture(fbo.tex);
}

/** Face-oval landmark indices (MediaPipe Face Mesh) */
const OVAL_IDX = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
  378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
  162, 21, 54, 103, 67, 109,
];

// ─── Renderer ─────────────────────────────────────────────────────────────────

export type Landmark = { x: number; y: number; z: number };

export class WebGLBeautyRenderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;

  // Programs
  private pLUT: WebGLProgram;
  private pBlur: WebGLProgram;
  private pComp: WebGLProgram;

  // Cached uniform locations
  private uLUT: Record<string, WebGLUniformLocation | null> = {};
  private uBlur: Record<string, WebGLUniformLocation | null> = {};
  private uComp: Record<string, WebGLUniformLocation | null> = {};

  // Textures
  private lutTex: WebGLTexture;
  private videoTex: WebGLTexture;

  // FBOs
  private fboSharp!: FBO;
  private fboBlurH!: FBO;
  private fboBlurV!: FBO;

  // Geometry
  private vao: WebGLVertexArrayObject;

  private lastW = 0;
  private lastH = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      powerPreference: "high-performance",
      // preserveDrawingBuffer: true so captureFromVideo (toDataURL) can read the canvas
      preserveDrawingBuffer: true,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("WebGL2 not supported");
    this.gl = gl;

    // ── Compile programs ──────────────────────────────────────────────────
    this.pLUT  = linkProg(gl, VERT, FRAG_LUT);
    this.pBlur = linkProg(gl, VERT, FRAG_BLUR);
    this.pComp = linkProg(gl, VERT, FRAG_COMP);

    // ── Cache uniform locations ───────────────────────────────────────────
    const U = (p: WebGLProgram, names: string[]) => {
      const m: Record<string, WebGLUniformLocation | null> = {};
      for (const n of names) m[n] = gl.getUniformLocation(p, n);
      return m;
    };
    this.uLUT  = U(this.pLUT,  ["u_video", "u_lut"]);
    this.uBlur = U(this.pBlur, ["u_tex", "u_dir"]);
    this.uComp = U(this.pComp, ["u_sharp", "u_soft", "u_hasFace", "u_fc", "u_fr"]);

    // ── 3-D LUT texture ───────────────────────────────────────────────────
    const lutData = buildPhotoismLUT();
    this.lutTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    gl.texImage3D(
      gl.TEXTURE_3D, 0, gl.RGBA,
      LUT_N, LUT_N, LUT_N, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, lutData
    );
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

    // ── Video texture (source, refreshed every frame) ─────────────────────
    this.videoTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // ── Full-screen quad VAO ──────────────────────────────────────────────
    // Layout: [x, y, u, v]
    // UV (0,0) = top-left; no UNPACK_FLIP_Y needed because mirror+orientation
    // is handled inside the Pass-1 fragment shader.
    const quad = new Float32Array([
      -1,  1,  0, 0,   // TL
       1,  1,  1, 0,   // TR
      -1, -1,  0, 1,   // BL
       1, -1,  1, 1,   // BR
    ]);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    // location 0 = a_pos (xy), location 1 = a_uv (uv)
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);
  }

  // ── FBO management ────────────────────────────────────────────────────────

  private resizeFBOs(w: number, h: number) {
    const gl = this.gl;
    if (this.lastW) {
      deleteFBO(gl, this.fboSharp);
      deleteFBO(gl, this.fboBlurH);
      deleteFBO(gl, this.fboBlurV);
    }
    this.fboSharp = makeFBO(gl, w, h);
    this.fboBlurH = makeFBO(gl, w, h);
    this.fboBlurV = makeFBO(gl, w, h);
    this.lastW = w;
    this.lastH = h;
  }

  // ── Main render ───────────────────────────────────────────────────────────

  render(video: HTMLVideoElement, landmarks: Landmark[] | null): void {
    const gl = this.gl;
    const w  = video.videoWidth;
    const h  = video.videoHeight;
    if (!w || !h || video.readyState < 2) return;

    // Keep canvas size in sync with video resolution
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width  = w;
      this.canvas.height = h;
    }
    if (w !== this.lastW || h !== this.lastH) this.resizeFBOs(w, h);

    gl.viewport(0, 0, w, h);
    gl.bindVertexArray(this.vao);

    // Upload current video frame (no UNPACK_FLIP_Y — orientation handled in shader)
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

    // ── Pass 1: video → fboSharp  (mirror + LUT) ─────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboSharp.fb);
    gl.useProgram(this.pLUT);
    gl.uniform1i(this.uLUT.u_video, 0);               // TEXTURE0
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    gl.uniform1i(this.uLUT.u_lut, 1);                 // TEXTURE1
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // ── Pass 2H: fboSharp → fboBlurH  (Gaussian horizontal, r=2px) ───────
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboBlurH.fb);
    gl.useProgram(this.pBlur);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fboSharp.tex);
    gl.uniform1i(this.uBlur.u_tex, 0);
    gl.uniform2f(this.uBlur.u_dir, 8 / w, 0);        // horizontal step = 8px (bloom)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // ── Pass 2V: fboBlurH → fboBlurV  (Gaussian vertical, r=2px) ─────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboBlurV.fb);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fboBlurH.tex);
    gl.uniform2f(this.uBlur.u_dir, 0, 8 / h);        // vertical step = 8px (bloom)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // ── Pass 3: fboSharp + fboBlurV → canvas  (composite + face mask) ─────
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.pComp);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fboSharp.tex);
    gl.uniform1i(this.uComp.u_sharp, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.fboBlurV.tex);
    gl.uniform1i(this.uComp.u_soft, 1);

    const hasFace = !!landmarks && landmarks.length >= 468;
    gl.uniform1i(this.uComp.u_hasFace, hasFace ? 1 : 0);

    if (hasFace && landmarks) {
      // Compute face bounding ellipse in display-UV space.
      // Pass 1 mirrored X → display UV x = 1 - landmark.x
      let cx = 0, cy = 0;
      let minX = 1, maxX = 0, minY = 1, maxY = 0;
      for (const i of OVAL_IDX) {
        const mx = 1 - landmarks[i].x; // mirror x
        const my = landmarks[i].y;
        cx += mx; cy += my;
        if (mx < minX) minX = mx;
        if (mx > maxX) maxX = mx;
        if (my < minY) minY = my;
        if (my > maxY) maxY = my;
      }
      cx /= OVAL_IDX.length;
      cy /= OVAL_IDX.length;
      // Slightly expand radii so the mask covers the full face oval
      gl.uniform2f(this.uComp.u_fc, cx, cy);
      gl.uniform2f(this.uComp.u_fr, (maxX - minX) * 0.58, (maxY - minY) * 0.58);
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  dispose() {
    const gl = this.gl;
    if (this.lastW) {
      deleteFBO(gl, this.fboSharp);
      deleteFBO(gl, this.fboBlurH);
      deleteFBO(gl, this.fboBlurV);
    }
    gl.deleteTexture(this.lutTex);
    gl.deleteTexture(this.videoTex);
    gl.deleteProgram(this.pLUT);
    gl.deleteProgram(this.pBlur);
    gl.deleteProgram(this.pComp);
  }
}
