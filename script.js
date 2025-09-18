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

  init();

  async function init() {
    loadState();
    try {
      manifest = await fetch('videos/manifest.json', { cache: 'no-store' }).then(r => r.json());
    } catch (e) {
      setProgress('未找到 videos/manifest.json，请先放入视频并执行构建生成清单。');
      disableAll(true);
      return;
    }

    attributes = Array.isArray(manifest.attributes) ? manifest.attributes : defaultAttributes();
    if (!Array.isArray(manifest.questions) || manifest.questions.length === 0) {
      setProgress('未检测到题目（videos 下没有包含视频的子文件夹）。');
      disableAll(true);
      return;
    }

    // 规范化
    manifest.questions = manifest.questions.map(q => ({
      id: String(q.id),
      videos: (q.videos || []).slice(0, 4)
    }));

    // 修正 current 越界
    if (current < 0) current = 0;
    if (current >= manifest.questions.length) current = manifest.questions.length - 1;

    // 初次渲染
    render();
    hookNav();
  }

  function defaultAttributes() {
    return [
      { key: 'clarity', label: '清晰度', desc: '画面细节是否清楚、锐利' },
      { key: 'stability', label: '稳定性', desc: '播放是否流畅、无明显卡顿' },
      { key: 'color', label: '色彩', desc: '颜色是否自然、对比度是否合适' },
      { key: 'audio', label: '音质', desc: '声音是否清晰、无噪声' },
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

    const videosHtml = `
      <div class="videos">
        ${q.videos.map((src, idx) => `
          <div class="video-card">
            <div style="color:#97a6ba;font-size:12px;margin:0 0 6px;">视频 ${idx + 1}</div>
            <video controls preload="metadata" src="${encodeURI(src)}"></video>
          </div>
        `).join('')}
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
                <span class="attr-desc">${escapeHtml(attr.desc || '')}</span>
              </div>
              <div class="scale">${buttons}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    els.q.innerHTML = `
      ${titleHtml}
      ${videosHtml}
      ${attrsHtml}
    `;

    // 绑定评分点击
    els.q.querySelectorAll('.attr-row').forEach(row => {
      const key = row.getAttribute('data-attr');
      row.querySelectorAll('.scale .btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const score = Number(btn.getAttribute('data-score'));
          selectScore(q.id, key, score, row, btn);
        });
      });
    });

    // 更新导航按钮状态与文案
    updateNavButtons();
  }

  function selectScore(qid, attrKey, score, row, btn) {
    if (!responses[qid]) responses[qid] = {};
    responses[qid][attrKey] = score;

    // 单选高亮
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

    els.next.addEventListener('click', () => {
      const isLast = current === manifest.questions.length - 1;
      if (isLast) {
        // 进入导出
        doExport();
      } else {
        current += 1;
        saveState();
        render();
      }
    });

    els.exportBtn.addEventListener('click', () => doExport());
  }

  function updateNavButtons() {
    const isFirst = current === 0;
    const isLast = current === manifest.questions.length - 1;
    const qid = manifest.questions[current].id;

    els.prev.disabled = isFirst;
    els.next.disabled = !allAttributesScored(qid);
    els.next.textContent = isLast ? '完成并导出' : '下一题';

    els.exportBtn.style.display = isLast && allAttributesScored(qid) ? 'inline-block' : 'none';
  }

  function doExport() {
    const payload = {
      meta: {
        generatedAt: new Date().toISOString(),
        totalQuestions: manifest.questions.length,
        attributes,
        questions: manifest.questions.map(q => q.id),
      },
      responses,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = `survey-results-${ts()}.json`;
    a.href = url;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 100);
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

  function setProgress(text) {
    els.progress.textContent = text;
  }

  function disableAll(disabled) {
    [els.prev, els.next, els.exportBtn].forEach(b => b.disabled = !!disabled);
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function ts() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }
})();
