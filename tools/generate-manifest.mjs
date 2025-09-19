import { promises as fs } from 'fs';
import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VIDEOS_DIR = path.join(ROOT, 'videos');
const MANIFEST_PATH = path.join(VIDEOS_DIR, 'manifest.json');

const exts = new Set(['.mp4', '.webm', '.ogg', '.mov', '.m4v']);
// 改为 3 个维度
const attributes = [
  { key: 'motion_preservation', label: 'motion preservation', desc: '动作保留程度（1=最好，7=最差）' },
  { key: 'text_alignment', label: 'text alignment', desc: '视频文本对齐程度（1=最好，7=最差）' },
  { key: 'generation_quality', label: 'generation quality', desc: '视频生成质量（1=最好，7=最差）' },
];

const EXPECTED_KEYS = ['camera_motion', 'complex_human_motion', 'single_object', 'multiple_objects'];

async function ensureDir(dir) {
  try { await fs.mkdir(dir, { recursive: true }); } catch {}
}

function toPosix(p) {
  return p.split(path.sep).join(path.posix.sep);
}

function baseNoExt(filename) {
  return path.parse(filename).name.toLowerCase();
}

async function listVideos(dir) {
  const items = await fs.readdir(dir, { withFileTypes: true });
  return items
    .filter(e => e.isFile() && exts.has(path.extname(e.name).toLowerCase()))
    .map(e => e.name)
    .sort((a, b) => a.localeCompare(b, 'en'));
}

async function main() {
  await ensureDir(VIDEOS_DIR);

  const entries = await fs.readdir(VIDEOS_DIR, { withFileTypes: true });
  // 收集 input 目录
  const INPUT_DIR = path.join(VIDEOS_DIR, 'input');
  const hasInput = entries.some(e => e.isDirectory() && e.name === 'input');
  const inputMap = new Map();
  if (hasInput) {
    const inputFiles = await listVideos(INPUT_DIR);
    for (const f of inputFiles) {
      inputMap.set(baseNoExt(f), toPosix(path.join('videos', 'input', f)));
    }
  } else {
    console.warn('[warn] 未发现 videos/input 目录，将无法配对参考视频。');
  }

  // 题目目录，排除 input
  const folders = entries
    .filter(e => e.isDirectory() && e.name !== 'input')
    .map(e => e.name)
    .sort();

  const questions = [];

  for (const folder of folders) {
    const full = path.join(VIDEOS_DIR, folder);
    const files = await listVideos(full);
    if (files.length === 0) continue;

    // 以预期 4 个 key 的顺序构建配对
    const byBase = new Map(files.map(f => [baseNoExt(f), f]));
    const pairs = [];

    for (const key of EXPECTED_KEYS) {
      const targetFile = byBase.get(key);
      if (!targetFile) {
        console.warn(`[warn] 目录 ${folder} 缺少 ${key} 对应视频，将跳过该项。`);
        continue;
      }
      const targetSrc = toPosix(path.join('videos', folder, targetFile));
      const inputSrc = inputMap.get(key);
      if (!inputSrc) {
        console.warn(`[warn] input 目录缺少 ${key} 视频，题目 ${folder} 的该配对将仅包含目标视频。`);
      }
      pairs.push({ key, target: targetSrc, input: inputSrc || null });
    }

    // 仅保留前 4 个预期项
    if (pairs.length > 0) {
      questions.push({ id: folder, pairs });
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
