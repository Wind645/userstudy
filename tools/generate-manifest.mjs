import { promises as fs } from 'fs';
import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VIDEOS_DIR = path.join(ROOT, 'videos');
const MANIFEST_PATH = path.join(VIDEOS_DIR, 'manifest.json');

const exts = new Set(['.mp4', '.webm', '.ogg', '.mov', '.m4v']);
const attributes = [
  { key: 'clarity', label: '清晰度', desc: '画面细节是否清楚、锐利' },
  { key: 'stability', label: '稳定性', desc: '播放是否流畅、无明显卡顿' },
  { key: 'color', label: '色彩', desc: '颜色是否自然、对比度是否合适' },
  { key: 'audio', label: '音质', desc: '声音是否清晰、无噪声' },
];

async function ensureDir(dir) {
  try { await fs.mkdir(dir, { recursive: true }); } catch {}
}

async function main() {
  await ensureDir(VIDEOS_DIR);

  const entries = await fs.readdir(VIDEOS_DIR, { withFileTypes: true });
  const folders = entries.filter(e => e.isDirectory()).map(e => e.name).sort();

  const questions = [];

  for (const folder of folders) {
    const full = path.join(VIDEOS_DIR, folder);
    const files = (await fs.readdir(full, { withFileTypes: true }))
      .filter(e => e.isFile() && exts.has(path.extname(e.name).toLowerCase()))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b, 'en'));

    if (files.length === 0) continue;

    const relFiles = files.map(f => path.posix.join('videos', folder, f));
    questions.push({
      id: folder,
      videos: relFiles.slice(0, 4) // 仅取前四个
    });

    if (relFiles.length !== 4) {
      console.warn(`[warn] 子文件夹 ${folder} 含 ${relFiles.length} 个视频，已取前4个。`);
    }
  }

  const manifest = { attributes, questions };
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`[ok] 生成清单：${path.relative(ROOT, MANIFEST_PATH)}，题目数：${questions.length}`);
}

main().catch(err => {
  console.error('[error] 生成 manifest 失败：', err);
  process.exit(1);
});
