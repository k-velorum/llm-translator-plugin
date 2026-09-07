(() => {
  'use strict';

  function requireCompleteElement(node, selected) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const textNode = walker.currentNode, entry = selected.get(textNode);
      // 選択の端にある要素の一部だけを移動すると、選択外の内容を巻き込む。
      if (!entry || entry.start !== 0 || entry.end !== textNode.length) throw Error('partial element');
    }
  }

  // HTML文字列は生成・挿入しない。モデルは既存要素のIDと文章だけを返す。
  function capture(entries) {
    const first = entries[0], last = entries.at(-1);
    const range = document.createRange();
    range.setStart(first.node, first.start);
    range.setEnd(last.node, last.end);
    const ancestor = range.commonAncestorContainer;
    const root = ancestor.nodeType === Node.TEXT_NODE ? ancestor.parentElement : ancestor;
    const selected = new Map(entries.map(entry => [entry.node, entry]));
    const elements = new Map();
    const layouts = [];
    const before = [], after = [], children = [];
    let started = false;

    function encode(node, parentId = null) {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const id = node.tagName.toLowerCase() + elements.size;
      elements.set(id, { node, parentId });
      layouts.push({ node, children: [...node.childNodes] });
      return { id, children: [...node.childNodes].map(child => encode(child, id)) };
    }
    for (const node of root.childNodes) {
      if (node.nodeType === Node.ELEMENT_NODE && node.matches('[data-llmt-ui]')) continue;
      if (node.nodeType === Node.TEXT_NODE && selected.has(node)) {
        const entry = selected.get(node);
        if (entry.start) before.push(document.createTextNode(entry.original.slice(0, entry.start)));
        children.push(entry.original.slice(entry.start, entry.end));
        if (entry.end < entry.original.length) after.push(document.createTextNode(entry.original.slice(entry.end)));
        started = true;
      } else if (node.nodeType === Node.ELEMENT_NODE && range.intersectsNode(node)) {
        requireCompleteElement(node, selected);
        children.push(encode(node));
        started = true;
      } else {
        (started ? after : before).push(node);
      }
    }
    layouts.unshift({ node: root, children: [...root.childNodes].filter(node =>
      node.nodeType !== Node.ELEMENT_NODE || !node.matches('[data-llmt-ui]')) });
    const text = range.toString();
    return { root, elements, layouts, before, after, children, original: snapshot(root),
      leading: text.match(/^\s*/)[0], trailing: text.match(/\s*$/)[0] };
  }

  function snapshot(root) {
    const nodes = [];
    const walk = node => {
      if (node.nodeType === Node.ELEMENT_NODE && node.matches('[data-llmt-ui]')) return;
      nodes.push({ node, parent: node.parentNode, next: nextContentSibling(node), value: node.nodeValue });
      node.childNodes.forEach(walk);
    };
    walk(root);
    const ancestry = [];
    let node = root;
    while (node.parentNode) {
      ancestry.push([node, node.parentNode]);
      node = node.parentNode;
    }
    return { root, nodes, ancestry };
  }

  function nextContentSibling(node) {
    let next = node.nextSibling;
    while (next?.nodeType === Node.ELEMENT_NODE && next.matches('[data-llmt-ui]')) next = next.nextSibling;
    return next;
  }

  function isCurrent(state) {
    return state.root.isConnected && state.ancestry.every(([node, parent]) => node.parentNode === parent) &&
      state.nodes.every(({ node, parent, next, value }) =>
        node.parentNode === parent && nextContentSibling(node) === next && node.nodeValue === value);
  }

  function plan(fragment, children) {
    const seen = new Set();
    let count = 0;
    function validate(items, parentId = null, depth = 0) {
      if (!Array.isArray(items) || depth > 50) throw Error('invalid children');
      return items.map(item => {
        if (++count > 10000) throw Error('too many items');
        if (typeof item === 'string') return item;
        const known = item && fragment.elements.get(item.id);
        if (!known || seen.has(item.id) || known.parentId !== parentId ||
          Object.keys(item).some(key => !['id', 'children'].includes(key))) throw Error('invalid element identity');
        seen.add(item.id);
        const children = validate(item.children, item.id, depth + 1);
        if (['BR', 'HR'].includes(known.node.tagName) && children.length) throw Error('invalid void element');
        if (known.node.tagName === 'A' && known.node.textContent.trim() && !plainText(children).trim()) throw Error('empty link');
        return { node: known.node, children };
      });
    }
    const result = validate(children);
    if (seen.size !== fragment.elements.size || !plainText(result).trim()) throw Error('missing translation');
    if (typeof result[0] === 'string') result[0] = result[0].trimStart();
    if (typeof result.at(-1) === 'string') result[result.length - 1] = result.at(-1).trimEnd();
    if (fragment.leading) result.unshift(fragment.leading);
    if (fragment.trailing) result.push(fragment.trailing);
    return result;
  }

  function plainText(items) {
    return items.map(item => typeof item === 'string' ? item : plainText(item.children)).join('');
  }

  function apply(fragment, plan) {
    function materialize(items) {
      return items.map(item => {
        if (typeof item === 'string') return document.createTextNode(item);
        item.node.replaceChildren(...materialize(item.children));
        return item.node;
      });
    }
    fragment.root.replaceChildren(...fragment.before, ...materialize(plan), ...fragment.after);
    fragment.expected = snapshot(fragment.root);
  }

  function restore(fragment) {
    // 子要素から戻してから親を戻すことで、元のノードとイベントを復元する。
    [...fragment.layouts].reverse().forEach(({ node, children }) => node.replaceChildren(...children));
  }

  window.LLMT.selectionFragments = { capture, snapshot, isCurrent, plan, apply, restore };
})();
