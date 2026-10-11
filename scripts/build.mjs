// 단일 HTML 파일 빌드 스크립트.
// - dist/index.html     : 완전한 HTML 문서 (브라우저/호스팅용)
// - dist/artifact.html  : claude.ai Artifact 게시용 (문서 골격 태그 제외)
// - android/app/src/main/assets/index.html : APK 내장용 (오프라인이라 웹폰트 링크 제외)
import { build, context } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const androidAssets = path.join(root, 'android/app/src/main/assets');
const args = new Set(process.argv.slice(2));

const esbuildOptions = {
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020', 'chrome87', 'safari14'],
  legalComments: 'inline',
  write: false,
  logLevel: 'warning',
};

async function assemble(jsText) {
  const [template, css] = await Promise.all([
    readFile(path.join(root, 'src/index.html'), 'utf8'),
    readFile(path.join(root, 'src/styles.css'), 'utf8'),
  ]);
  // </script 가 문자열로 들어 있으면 HTML 파서가 스크립트를 끊으므로 이스케이프
  const js = jsText.replace(/<\/script/gi, '<\\/script');
  const fill = (tpl) => tpl
    .replace('/*__CSS__*/', () => css)
    .replace('/*__JS__*/', () => js);

  const full = fill(template);
  // Artifact 게시본: 골격(doctype/html/head/body)과 charset·viewport meta 는 게시 시 자동으로 감싸지므로 제거
  const artifact = fill(template)
    .replace(/<!doctype html>\s*/i, '')
    .replace(/<html[^>]*>\s*/i, '')
    .replace(/<\/html>\s*/i, '')
    .replace(/<head>\s*/i, '')
    .replace(/<\/head>\s*/i, '')
    .replace(/<body[^>]*>\s*/i, '')
    .replace(/<\/body>\s*/i, '')
    .replace(/<meta charset[^>]*>\s*/i, '')
    .replace(/<meta name="viewport"[^>]*>\s*/i, '');
  // APK 는 인터넷 권한 없이 동작하므로 웹폰트 링크 제거 (시스템 한글 폰트 사용)
  const android = full.replace(/<!--FONTS-->[\s\S]*?<!--\/FONTS-->\s*/, '');

  await mkdir(dist, { recursive: true });
  await mkdir(androidAssets, { recursive: true });
  await Promise.all([
    writeFile(path.join(dist, 'index.html'), full),
    writeFile(path.join(dist, 'artifact.html'), artifact),
    writeFile(path.join(androidAssets, 'index.html'), android),
  ]);
  const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0) + 'KB';
  console.log(`built dist/index.html (${kb(full)}), dist/artifact.html (${kb(artifact)}), android asset (${kb(android)})`);
}

if (args.has('--watch')) {
  const ctx = await context({
    ...esbuildOptions,
    plugins: [{
      name: 'assemble',
      setup(b) {
        b.onEnd(async (result) => {
          if (result.errors.length) return;
          await assemble(result.outputFiles[0].text);
        });
      },
    }],
  });
  await ctx.watch();
  if (args.has('--serve')) {
    const port = Number(process.env.PORT || 5173);
    createServer(async (req, res) => {
      try {
        const html = await readFile(path.join(dist, 'index.html'));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(html);
      } catch {
        res.writeHead(503); res.end('building...');
      }
    }).listen(port, () => console.log(`dev server: http://localhost:${port}`));
  }
} else {
  const result = await build(esbuildOptions);
  await assemble(result.outputFiles[0].text);
}
