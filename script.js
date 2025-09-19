(() => {
  const els = {
    app: document.getElementById('app'),
    q: document.getElementById('question'),
    progress: document.getElementById('progress'),
    prev: document.getElementById('prevBtn'),
    next: document.getElementById('nextBtn'),
    exportBtn: document.getElementById('exportBtn'),
  };

  const STORAGE_RESP = 'surveyResponses.v1';
  const STORAGE_INDEX = 'surveyCurrentIndex.v1';

  let manifest = null;
  let current = 0;
  let responses = {};
  let attributes = [];
  let prompts = {};

  init();

  async function init() {
    loadState();

    // 读取 prompts.json（可选）
    try {
      prompts = await fetch('prompts.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : {});
    } catch { prompts = {}; }

    try {
      manifest = await fetch('videos/manifest.json', { cache: 'no-store' }).then(r => r.json());
    } catch (e) {
      setProgress('未找到 videos/manifest.json，请先放入视频并执行构建生成清单。');
      disableAll(true);
      return;
    }

    // 使用后端提供的 3 个维度；否则降级为默认
    attributes = Array.isArray(manifest.attributes) && manifest.attributes.length
      ? manifest.attributes
      : defaultAttributes();

    if (!Array.isArray(manifest.questions) || manifest.questions.length === 0) {
      setProgress('未检测到题目（videos 下没有包含视频的子文件夹，或仅有 input）。');
      disableAll(true);
      return;
    }

    // 规范化：确保 pairs 存在
    manifest.questions = manifest.questions.map(q => ({
      id: String(q.id),
      pairs: Array.isArray(q.pairs) ? q.pairs.slice(0, 4) : []
    })).filter(q => q.pairs.length > 0);

    if (manifest.questions.length === 0) {
      setProgress('没有可用的配对视频。请检查各题目目录与 input 是否包含同名文件。');
      disableAll(true);
      return;
    }

    if (current < 0) current = 0;
    if (current >= manifest.questions.length) current = manifest.questions.length - 1;

    render();
    hookNav();
  }

  function defaultAttributes() {
    return [
      { key: 'motion_preservation', label: 'motion preservation', desc: '动作保留程度（1=最好，7=最差）' },
      { key: 'text_alignment', label: 'text alignment', desc: '视频文本对齐程度（1=最好，7=最差）' },
      { key: 'generation_quality', label: 'generation quality', desc: '视频生成质量（1=最好，7=最差）' },
    ];
  }

  function render() {
    const total = manifest.questions.length;
    const q = manifest.questions[current];
    setProgress(`进度：${current + 1} / ${total}`);

    const titleHtml = `
      <div class="q-title">
        <h2>题目 ${current + 1}</h2>
        <span class="qid">ID：${escapeHtml(q.id)}</span>
      </div>
    `;

    // 每个配对：上方显示 prompt；下方两列视频（左 input，右 target）
    const pairsHtml = `
      <div>
        ${q.pairs.map((p, idx) => {
          const key = String(p.key || inferKey(p));
          const prompt = prompts[key] || '';
          const inputHtml = p.input ? `
            <div class="video-card">
              <div style="color:#97a6ba;font-size:12px;margin:0 0 6px;">Input（${escapeHtml(key)}）</div>
              <video controls preload="metadata" src="${encodeURI(p.input)}"></video>
            </div>
          ` : `
            <div class="video-card">
              <div style="color:#97a6ba;font-size:12px;margin:0 0 6px;">Input 缺失（${escapeHtml(key)}）</div>
              <div style="color:#97a6ba;font-size:12px;">未找到对应 input 视频</div>
            </div>
          `;
          const targetHtml = `
            <div class="video-card">
              <div style="color:#97a6ba;font-size:12px;margin:0 0 6px;">题目视频（${escapeHtml(key)}）</div>
              <video controls preload="metadata" src="${encodeURI(p.target)}"></video>
            </div>
          `;
          return `
            <div class="pair">
              <div class="pair-title">Prompt：${escapeHtml(prompt)}</div>
              <div class="pair-videos">
                ${inputHtml}
                ${targetHtml}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    const attrResp = responses[q.id] || {};
    const attrsHtml = `
      <div class="attrs">
        ${attributes.map(attr => {
          const selected = Number(attrResp[attr.key] || 0);
          const buttons = Array.from({ length: 7 }, (_, i) => {
            const val = i + 1;
            const sel = selected === val ? 'selected' : '';
            return `<button class="btn ${sel}" data-score="${val}">${val}</button>`;
          }).join('');
          return `
            <div class="attr-row" data-attr="${attr.key}">
              <div class="attr-head">
                <span class="attr-label">${escapeHtml(attr.label)}</span>
                <span class="attr-desc">${escapeHtml(attr.desc || '（1=最好，7=最差）')}</span>
              </div>
              <div class="scale">${buttons}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    els.q.innerHTML = `
      ${titleHtml}
      ${pairsHtml}
      ${attrsHtml}
    `;

    els.q.querySelectorAll('.attr-row').forEach(row => {
      const key = row.getAttribute('data-attr');
      row.querySelectorAll('.scale .btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const score = Number(btn.getAttribute('data-score'));
          selectScore(q.id, key, score, row, btn);
        });
      });
    });

    updateNavButtons();
  }

  function inferKey(p) {
    // 从 target 路径推断 key（去扩展名的文件名）
    try {
      const parts = String(p.target || '').split('/');
      const f = parts[parts.length - 1] || '';
      return f.split('.').slice(0, -1).join('.');
    } catch { return ''; }
  }

  function selectScore(qid, attrKey, score, row, btn) {
    if (!responses[qid]) responses[qid] = {};
    responses[qid][attrKey] = score;
    row.querySelectorAll('.scale .btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    saveState();
    updateNavButtons();
  }

  function allAttributesScored(qid) {
    const r = responses[qid] || {};
    return attributes.every(a => typeof r[a.key] === 'number' && r[a.key] >= 1 && r[a.key] <= 7);
  }

  function hookNav() {
    els.prev.addEventListener('click', () => {
      if (current > 0) {
        current -= 1;
        saveState();
        render();
      }
    });

    els.next.addEventListener('click', async () => {
      const isLast = current === manifest.questions.length - 1;
      if (isLast) {
        await doSubmit();
      } else {
        current += 1;
        saveState();
        render();
      }
    });

    // 导出按钮不再使用
    els.exportBtn.style.display = 'none';
  }

  function updateNavButtons() {
    const isFirst = current === 0;
    const isLast = current === manifest.questions.length - 1;
    const qid = manifest.questions[current].id;

    els.prev.disabled = isFirst;
    els.next.disabled = !allAttributesScored(qid);
    els.next.textContent = isLast ? '提交' : '下一题';
  }

  async function doSubmit() {
    const payload = {
      meta: {
        generatedAt: new Date().toISOString(),
        totalQuestions: manifest.questions.length,
        attributes,
        questions: manifest.questions.map(q => q.id),
        userAgent: navigator.userAgent,
      },
      responses,
    };

    try {
      const fd = new FormData();
      fd.append('form-name', 'video-survey');
      fd.append('payload', JSON.stringify(payload));

      await fetch('/', { method: 'POST', body: fd });

      // 清理并提示
      localStorage.removeItem(STORAGE_RESP);
      localStorage.removeItem(STORAGE_INDEX);
      setProgress('已提交，感谢参与！');
      els.q.innerHTML = `
        <div class="q-title">
          <h2>提交成功</h2>
          <span class="qid">数据已保存到 Netlify 后台（Forms）。</span>
        </div>
      `;
      els.prev.disabled = true;
      els.next.disabled = true;
    } catch (e) {
      alert('提交失败，请稍后重试。');
      console.error('submit error:', e);
    }
  }

  function loadState() {
    try {
      const r = localStorage.getItem(STORAGE_RESP);
      const i = localStorage.getItem(STORAGE_INDEX);
      if (r) responses = JSON.parse(r) || {};
      if (i) current = Number(i) || 0;
    } catch {}
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_RESP, JSON.stringify(responses));
      localStorage.setItem(STORAGE_INDEX, String(current));
    } catch {}
  }

  function setProgress(text) { els.progress.textContent = text; }

  function disableAll(disabled) { [els.prev, els.next, els.exportBtn].forEach(b => b.disabled = !!disabled); }

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
})();
