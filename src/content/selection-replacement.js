(() => {
  'use strict';

  const unsafe = 'button, input, textarea, select, option, label, [contenteditable], ' +
    '[role~="button"], :not(a)[role~="link"], [role~="textbox"], [role~="combobox"], [role~="listbox"], ' +
    '[role~="menu"], [role~="menuitem"], [role~="checkbox"], [role~="radio"], [role~="slider"], ' +
    '[role~="switch"], [role~="tab"], [onclick], [translate="no"], .notranslate, [data-llmt-ui], ' +
    'script, style, code, pre, img, svg, math, canvas, video, audio, iframe, ruby';
  const inlineTags = new Set(['A', 'SPAN', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SMALL', 'MARK', 'SUB', 'SUP']);
  let remembered = null;
  let pending = null;
  const history = [];
  let panel = null;

  function remember(source = 'contextmenu') {
    const selection = window.getSelection();
    remembered = selection?.rangeCount === 1 ? {
      range: selection.getRangeAt(0).cloneRange(),
      text: selection.toString(),
      source,
      entries: captureEntries(selection.getRangeAt(0)),
      time: Date.now()
    } : null;
  }
  document.addEventListener('contextmenu', () => remember(), true);

  function blockFor(node) {
    let parent = node.parentElement;
    while (parent && parent !== document.body && inlineTags.has(parent.tagName) &&
      getComputedStyle(parent).display === 'inline') parent = parent.parentElement;
    return parent;
  }

  function captureEntries(range) {
    const root = range.commonAncestorContainer;
    const nodes = [];
    if (root.nodeType === Node.TEXT_NODE) nodes.push(root);
    else {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) nodes.push(walker.currentNode);
    }
    return nodes.filter(node => range.intersectsNode(node)).map(node => ({
      node,
      original: node.nodeValue,
      start: node === range.startContainer ? range.startOffset : 0,
      end: node === range.endContainer ? range.endOffset : node.length,
      block: blockFor(node),
      ancestry: ancestryOf(node)
    })).filter(entry => entry.end > entry.start);
  }

  function ancestryOf(node) {
    const ancestry = [];
    while (node.parentNode) {
      ancestry.push([node, node.parentNode]);
      node = node.parentNode;
    }
    return ancestry;
  }

  function observe(session) {
    session.observer = new MutationObserver(records => {
      if (records.some(isPageMutation)) session.dirty = true;
    });
    for (const block of new Set(session.entries.map(entry => entry.block))) {
      session.observer.observe(block, { subtree: true, childList: true, characterData: true, attributes: true });
    }
  }

  function isPageMutation(record) {
    const element = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
    if (element?.closest('[data-llmt-ui]')) return false;
    return record.type !== 'childList' || [...record.addedNodes, ...record.removedNodes].some(node =>
      node.nodeType !== Node.ELEMENT_NODE || !node.matches('[data-llmt-ui]'));
  }

  function pauseHistory() {
    for (const session of history) {
      if (session.observer.takeRecords().some(isPageMutation)) session.dirty = true;
      session.observer.disconnect();
    }
  }

  function unchanged(session, translated = false) {
    return !session.dirty && !session.observer.takeRecords().some(isPageMutation) &&
      session.fragments.every(fragment => !fragment.root.closest(unsafe) && !fragment.root.isContentEditable &&
        window.LLMT.selectionFragments.isCurrent(translated ? fragment.expected : fragment.original));
  }

  function stopPending() {
    if (!pending) return;
    window.cancelTranslationStream(pending.id);
    pending.observer.disconnect();
    pending = null;
  }

  function renderPanel(message = '') {
    panel?.remove();
    panel = null;
    if (!pending && !history.length && !message) return;
    panel = document.createElement('div');
    panel.dataset.llmtUi = '';
    panel.setAttribute('role', 'status');
    Object.assign(panel.style, { position: 'fixed', bottom: '18px', right: '18px', zIndex: '2147483647',
      background: '#fff', color: '#24354b', border: '1px solid #ccd7e6', borderRadius: '10px',
      padding: '12px', boxShadow: '0 4px 20px #0002', font: '14px sans-serif', maxWidth: '340px' });
    const label = document.createElement('div');
    label.textContent = message || (pending ? '選択範囲を翻訳しています…' : '選択範囲を置換しました');
    panel.append(label);
    const button = (text, action) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.textContent = text;
      element.style.margin = '8px 8px 0 0';
      element.onclick = action;
      panel.append(element);
    };
    if (pending) button('キャンセル', () => { stopPending(); renderPanel(); });
    else if (history.length) button('原文に戻す', undo);
    else button('閉じる', () => { panel.remove(); panel = null; });
    document.body.append(panel);
  }

  function selectedRange(text, source) {
    const selection = window.getSelection();
    const saved = remembered && remembered.source === source && Date.now() - remembered.time < 60000 ? remembered : null;
    const range = saved ? saved.range : selection?.rangeCount === 1 ? selection.getRangeAt(0).cloneRange() : null;
    remembered = null;
    // Selectionは段落境界に改行を含むが、Rangeの文字列には含まれない。
    if (!range || range.collapsed || range.toString().replace(/\s/g, '') !== text.replace(/\s/g, '')) return null;
    if (saved && (saved.text.trim() !== text.trim() || saved.entries.some(entry =>
      !entry.node.isConnected || entry.node.nodeValue !== entry.original))) return null;
    return range;
  }

  function canReplace(range, entries) {
    const root = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    return entries.length > 0 && !entries.some(entry => !entry.block || entry.node.parentElement.closest(unsafe) ||
      entry.node.parentElement.isContentEditable) &&
      ![...root.querySelectorAll(unsafe)].some(element => range.intersectsNode(element));
  }

  function prepare(text, source) {
    window.removePopup?.();
    stopPending();
    renderPanel();
    const range = selectedRange(text, source);
    const reason = 'この範囲は構造を保って置換できないため、ポップアップで表示します。';
    if (!range) return { reason };
    const entries = captureEntries(range);
    if (!canReplace(range, entries)) return { reason };
    const groups = [];
    for (const entry of entries) {
      if (groups.at(-1)?.block !== entry.block) groups.push({ block: entry.block, entries: [] });
      groups.at(-1).entries.push(entry);
    }
    let fragments;
    try {
      fragments = groups.filter(group => group.entries.some(entry =>
        entry.original.slice(entry.start, entry.end).trim())).map(group => window.LLMT.selectionFragments.capture(group.entries));
    } catch {
      return { reason: '選択の端がHTML要素の途中にあるため、ポップアップで表示します。' };
    }
    if (!fragments.length) return { reason };
    if (fragments.some((fragment, i) => fragments.some((other, j) => i !== j && other.root.contains(fragment.root)))) {
      return { reason: '選択範囲に入れ子の段落があるため、ポップアップで表示します。' };
    }
    pending = { id: crypto.getRandomValues(new Uint32Array(4)).join('-'), entries, fragments, dirty: false };
    observe(pending);
    renderPanel();
    return { requestId: pending.id, paragraphs: fragments.map((fragment, id) => ({ id, children: fragment.children })) };
  }

  function finish(requestId, translations, error = '') {
    if (!pending || pending.id !== requestId) return { ignored: true };
    const session = pending;
    pending = null;
    let plans = null;
    try {
      if (error || !Array.isArray(translations) || translations.length !== session.fragments.length || !unchanged(session)) {
        throw Error('invalid selection response');
      }
      plans = session.fragments.map((fragment, i) => {
        const paragraph = translations[i];
        if (paragraph?.id !== i) throw Error('invalid paragraph order');
        return window.LLMT.selectionFragments.plan(fragment, paragraph.children);
      });
    } catch {
      session.observer.disconnect();
      renderPanel();
      return { reason: error || '翻訳結果とHTMLの対応を確認できないため、ポップアップで表示します。' };
    }
    session.observer.disconnect();
    pauseHistory();
    try {
      session.fragments.forEach((fragment, i) => window.LLMT.selectionFragments.apply(fragment, plans[i]));
    } catch {
      session.fragments.forEach(fragment => window.LLMT.selectionFragments.restore(fragment));
      history.forEach(observe);
      renderPanel();
      return { reason: 'HTMLへの反映に失敗したため、原文に戻しました。' };
    }
    history.forEach(observe);
    history.push(session);
    observe(session);
    renderPanel();
    return { ok: true };
  }

  function undo() {
    const session = history.pop();
    if (!session) return;
    const valid = unchanged(session, true);
    session.observer.disconnect();
    pauseHistory();
    if (valid) session.fragments.forEach(fragment => window.LLMT.selectionFragments.restore(fragment));
    history.forEach(observe);
    renderPanel(valid ? '' : 'ページが更新されたため、この置換を元に戻せませんでした。');
    return { ok: valid };
  }

  window.LLMT.selectionReplacement = { prepare, finish, undo, remember };
})();
