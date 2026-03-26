import type { NextConfig } from "next";
import path from "path";

/** 프로젝트 루트에서 `npm run dev` 할 때만 사용. 상위 폴더 lockfile 경고·모듈 루트 꼬임 완화(import.meta 없이). */
const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(process.cwd()),
};

export default nextConfig;
