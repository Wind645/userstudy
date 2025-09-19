import { promises as fs } from 'fs';
import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VIDEOS_DIR = path.join(ROOT, 'videos');
const MANIFEST_PATH = path.join(VIDEOS_DIR, 'manifest.json');

const exts = new Set(['.mp4', '.webm', '.ogg', '.mov', '.m4v']);

// 三个排序指标
const attributes = [
  { key: 'motion_preservation', label: 'motion preservation', desc: '动作迁移程度（1=最好，N=最差）' },
  { key: 'text_alignment', label: 'text alignment', desc: '视频文本对齐程度（1=最好，N=最差）' },
  { key: 'generation_quality', label: 'generation quality', desc: '视频生成质量（1=最好，N=最差）' },
];

const KINDS = ['camera_motion', 'complex_human_motion', 'single_object', 'multiple_objects'];

async function ensureDir(dir) { try { await fs.mkdir(dir, { recursive: true }); } catch {} }
function toPosix(p) { return p.split(path.sep).join(path.posix.sep); }
function baseNoExt(filename) { return path.parse(filename).name.toLowerCase(); }
function normalizeKey(s) {
  return String(s)
    .toLowerCase()
    .replace(/[\s_\-]+/g, '')        // 去掉空格/下划线/连字符
    .replace(/\(\d+\)|\[\d+\]/g, '')  // 去掉(1)/[1]等
    .replace(/copy|副本/g, '');       // 常见复制后缀
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

  // 收集 input 参考（大小写不敏感）
  const dirEntries = entries.filter(e => e.isDirectory());
  const inputEntry = dirEntries.find(e => e.name.toLowerCase() === 'input');
  const inputDirName = inputEntry?.name;
  const hasInput = !!inputDirName;
  const INPUT_DIR = hasInput ? path.join(VIDEOS_DIR, inputDirName) : null;
  const inputMap = new Map();
  if (hasInput) {
    const inputFiles = await listVideos(INPUT_DIR);
    for (const f of inputFiles) inputMap.set(baseNoExt(f), toPosix(path.join('videos', inputDirName, f)));
  } else {
    console.warn('[warn] 未发现 videos/input 目录（大小写不敏感），将无法展示参考视频。');
  }

  // 候选来源目录（排除 input，大小写不敏感）
  const folders = dirEntries
    .map(e => e.name)
    .filter(name => name.toLowerCase() !== 'input')
    .sort((a, b) => a.localeCompare(b, 'en'));

  const kindToCandidates = new Map(KINDS.map(k => [k, []]));

  // 遍历每个子文件夹，将四类视频分发到对应类别的候选池
  for (const folder of folders) {
    const folderDir = path.join(VIDEOS_DIR, folder);
    const files = await listVideos(folderDir);
    if (files.length === 0) continue;

    // 放宽匹配：精确(normalized)优先，否则接受以类别名为前缀的匹配
    const fileInfos = files.map(f => ({ file: f, base: baseNoExt(f), key: normalizeKey(baseNoExt(f)) }));
    for (const kind of KINDS) {
      const nk = normalizeKey(kind);
      const exact = fileInfos.find(x => x.key === nk);
      const prefix = exact || fileInfos.find(x => x.key.startsWith(nk));
      const hit = prefix;
      if (!hit) continue;
      const src = toPosix(path.join('videos', folder, hit.file));
      kindToCandidates.get(kind).push({ id: folder, src });
    }
  }

  // 组装四道题：每题至多取 8 个候选
  const questions = KINDS.map(kind => {
    const candidates = (kindToCandidates.get(kind) || []).slice(0, 8);
    const input = inputMap.get(kind) || null;
    return { id: kind, kind, input, candidates };
  });

  const manifest = { attributes, questions };
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`[ok] 生成清单：${path.relative(ROOT, MANIFEST_PATH)}，题目数：${questions.length}`);
}

main().catch(err => {
  console.error('[error] 生成 manifest 失败：', err);
  process.exit(1);
});