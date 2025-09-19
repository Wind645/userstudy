(() => {
  const els = {
    app: document.getElementById('app'),
    q: document.getElementById('question'),
    progress: document.getElementById('progress'),
    prev: document.getElementById('prevBtn'),
    next: document.getElementById('nextBtn'),
    exportBtn: document.getElementById('exportBtn'),
  };

  const STORAGE_RESP = 'surveyResponses.v2';
  const STORAGE_INDEX = 'surveyCurrentIndex.v2';

  const KIND_LABELS = {
    camera_motion: 'Camera Motion',
    complex_human_motion: 'Complex Human Motion',
    single_object: 'Single Object',
    multiple_objects: 'Multiple Objects',
  };

  let manifest = null;
  let current = 0;
  let responses = {};
  let attributes = [];
  let prompts = {};

  init();

  async function init() {
    loadState();

    // 读取 prompts.json
    try {
      prompts = await fetch('prompts.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : {});
    } catch { prompts = {}; }

    // 读取 manifest
    try {
      manifest = await fetch('videos/manifest.json', { cache: 'no-store' }).then(r => r.json());
    } catch {
      setProgress('未找到 videos/manifest.json，请先执行构建。');
      disableAll(true);
      return;
    }

    // 3 个排序指标
    attributes = Array.isArray(manifest.attributes) && manifest.attributes.length
      ? manifest.attributes
      : defaultAttributes();

    // 格式化题目：每题包含 kind、input、candidates
    if (!Array.isArray(manifest.questions) || manifest.questions.length === 0) {
      setProgress('未检测到题目。');
      disableAll(true);
      return;
    }
    manifest.questions = manifest.questions.map(q => ({
      id: String(q.id),
      kind: String(q.kind || q.id),
      input: q.input || null,
      candidates: Array.isArray(q.candidates) ? q.candidates.slice(0, 8) : [],
    })).filter(q => q.candidates.length > 0);

    if (manifest.questions.length === 0) {
      setProgress('没有可用候选视频，请检查子文件夹与文件命名。');
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
      { key: 'motion_preservation', label: 'motion preservation', desc: '动作迁移程度（1=最好，N=最差）' },
      { key: 'text_alignment', label: 'text alignment', desc: '视频文本对齐程度（1=最好，N=最差）' },
      { key: 'generation_quality', label: 'generation quality', desc: '视频生成质量（1=最好，N=最差）' },
    ];
  }

  function render() {
    const total = manifest.questions.length;
    const q = manifest.questions[current];
    const kind = q.kind;
    const N = q.candidates.length;

    setProgress(`进度：${current + 1} / ${total}`);

    const titleHtml = `
      <div class="q-title">
        <h2>题目 ${current + 1}：${escapeHtml(KIND_LABELS[kind] || kind)}</h2>
        <span class="qid">类别ID：${escapeHtml(kind)}</span>
      </div>
    `;

    const promptText = prompts[kind] || '';
    const refHtml = `
      <div class="pair">
        <div class="pair-title">Prompt：${escapeHtml(promptText)}</div>
        <div class="pair-videos">
          <div class="video-card">
            <div style="color:#97a6ba;font-size:12px;margin:0 0 6px;">Input</div>
            ${q.input
              ? `<video controls preload="metadata" src="${encodeURI(q.input)}"></video>`
              : `<div style="color:#97a6ba;font-size:12px;">未找到对应 input 视频</div>`}
          </div>
        </div>
      </div>
    `;

    // 候选视频展示（仅标号，不显示文件夹名）
    const candidatesHtml = `
      <div class="videos">
        ${q.candidates.map((c, i) => `
          <div class="video-card">
            <div style="color:#97a6ba;font-size:12px;margin:0 0 6px;">视频 ${i + 1}</div>
            <video controls preload="metadata" src="${encodeURI(c.src)}"></video>
          </div>
        `).join('')}
      </div>
    `;

    // 初始化该题的排序响应（若不存在）
    if (!responses[kind]) {
      responses[kind] = { rankings: {} };
      const ids = q.candidates.map(c => c.id + '|' + c.src); // 稳定标识
      for (const attr of attributes) responses[kind].rankings[attr.key] = ids.slice(); // 初始顺序
      saveState();
    }

    // 排序区域
    const rankSectionsHtml = `
      <div class="rank-sections">
        ${attributes.map(attr => rankSectionHtml(kind, attr, q)).join('')}
      </div>
    `;

    els.q.innerHTML = `
      ${titleHtml}
      ${refHtml}
      ${candidatesHtml}
      ${rankSectionsHtml}
    `;

    // 绑定拖拽
    attributes.forEach(attr => bindRankDnD(kind, attr.key, q));
    updateNavButtons();
  }

  function rankSectionHtml(kind, attr, q) {
    const order = (responses[kind]?.rankings?.[attr.key]) || q.candidates.map(c => c.id + '|' + c.src);
    const idToIndex = new Map(q.candidates.map((c, i) => [c.id + '|' + c.src, i]));
    const items = order.map((cid, pos) => {
      const i = idToIndex.get(cid) ?? 0;
      return `
        <li class="rank-item" draggable="true" data-id="${escapeHtml(cid)}" data-pos="${pos}">
          <span class="order">${pos + 1}</span>
          <span class="label">视频 ${i + 1}</span>
        </li>
      `;
    }).join('');

    return `
      <section class="rank-section" data-attr="${attr.key}">
        <div class="rank-title">${escapeHtml(attr.label)}</div>
        <div class="rank-desc">${escapeHtml(attr.desc || '（1=最好，N=最差）')}</div>
        <ol class="rank-list" id="rank-${attr.key}">
          ${items}
        </ol>
      </section>
    `;
  }

  function bindRankDnD(kind, attrKey, q) {
    const list = document.getElementById(`rank-${attrKey}`);
    if (!list) return;

    let dragEl = null;

    list.addEventListener('dragstart', (e) => {
      const li = e.target.closest('.rank-item');
      if (!li) return;
      dragEl = li;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', li.dataset.id);
      setTimeout(() => li.classList.add('dragging'), 0);
    });

    list.addEventListener('dragend', (e) => {
      const li = e.target.closest('.rank-item');
      if (li) li.classList.remove('dragging');
      dragEl = null;
    });

    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      const after = getDragAfterElement(list, e.clientY);
      const dragging = list.querySelector('.dragging');
      if (!dragging) return;
      if (after == null) {
        list.appendChild(dragging);
      } else {
        list.insertBefore(dragging, after);
      }
    });

    list.addEventListener('drop', (e) => {
      e.preventDefault();
      // 根据当前列表顺序重建 order
      const ids = Array.from(list.querySelectorAll('.rank-item')).map(li => li.dataset.id);
      responses[kind].rankings[attrKey] = ids;
      // 重绘序号
      Array.from(list.querySelectorAll('.rank-item .order')).forEach((el, i) => el.textContent = String(i + 1));
      saveState();
      updateNavButtons();
    });
  }

  function getDragAfterElement(container, y) {
    const els = [...container.querySelectorAll('.rank-item:not(.dragging)')];
    return els.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
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

    // 不使用导出
    els.exportBtn.style.display = 'none';
  }

  function isQuestionComplete(kind) {
    const q = manifest.questions.find(qq => qq.kind === kind);
    if (!q) return false;
    const N = q.candidates.length;
    const r = responses[kind]?.rankings || {};
    return attributes.every(a => Array.isArray(r[a.key]) && r[a.key].length === N);
  }

  function updateNavButtons() {
    const isFirst = current === 0;
    const isLast = current === manifest.questions.length - 1;
    const kind = manifest.questions[current].kind;

    els.prev.disabled = isFirst;
    els.next.disabled = !isQuestionComplete(kind);
    els.next.textContent = isLast ? '提交' : '下一题';
  }

  async function doSubmit() {
    const payload = {
      meta: {
        generatedAt: new Date().toISOString(),
        totalQuestions: manifest.questions.length,
        kinds: manifest.questions.map(q => q.kind),
        attributes,
        userAgent: navigator.userAgent,
      },
      // 提交排序结果（不暴露文件夹名给用户界面，但后端数据包含 id/src）
      responses,
    };

    try {
      const fd = new FormData();
      fd.append('form-name', 'video-survey');
      fd.append('payload', JSON.stringify(payload));
      await fetch('/', { method: 'POST', body: fd });

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
