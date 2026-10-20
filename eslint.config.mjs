import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([".next/**", ".cache/**", "out/**", "coverage/**", "tmp/**", "next-env.d.ts", "public/wasm/anime-face-recognition/*.mjs",
    // Video Enhancer is withdrawn and kept local only (see .gitignore).
    "src/lib/video-enhancer/**", "src/workers/video-enhancer*.ts", "src/app/lab/*/video-enhancer-workspace.*", "scripts/*enhancer*", "scripts/verify-learned-restoration*", "public/wasm/video-enhancer/**"]),
]);
