function iconButton(label, path) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'preset-icon-button';
  button.title = label;
  button.setAttribute('aria-label', label);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS(svg.namespaceURI, 'path');
  shape.setAttribute('d', path);
  svg.appendChild(shape);
  button.appendChild(svg);
  return button;
}

// 追加・削除は接続フォームの下書きに適用し、通常の「変更を保存」で確定する。
export function mountPresetControls(select, { add, remove, container }) {
  const heading = document.createElement('div');
  heading.className = 'preset-heading';
  const presetLabel = select.previousElementSibling;
  presetLabel.before(heading);
  heading.appendChild(presetLabel);
  const toggle = iconButton('現在の設定からプリセットを追加', 'M12 5v14M5 12h14');
  const removeButton = iconButton('選択中のプリセットを削除', 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7');
  heading.append(toggle, removeButton);
  const group = document.createElement('div');
  group.className = 'preset-controls';
  group.id = 'preset-create-panel';
  group.hidden = true;
  toggle.setAttribute('aria-controls', group.id);
  toggle.setAttribute('aria-expanded', 'false');
  const label = document.createElement('label');
  label.textContent = '新しいプリセット名';
  const name = document.createElement('input');
  name.type = 'text';
  name.maxLength = 80;
  name.placeholder = '例：自宅のLM Studio';
  // 名前の下書きだけでは接続設定を未保存にしない。
  label.appendChild(name);
  const buttons = document.createElement('div');
  buttons.className = 'preset-actions';
  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'btn-secondary';
  addButton.textContent = '追加';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn-secondary';
  cancel.textContent = 'キャンセル';
  const status = document.createElement('div');
  status.className = 'note preset-status';
  status.setAttribute('role', 'status');
  function show(open) {
    group.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) name.focus();
  }
  function apply(action, message) {
    try {
      action();
      show(false);
      status.textContent = `${message}「変更を保存」で確定します。`;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.focus();
    } catch (error) { status.textContent = error.message; }
  }
  toggle.addEventListener('click', () => { status.textContent = ''; show(group.hidden); });
  cancel.addEventListener('click', () => { show(false); status.textContent = ''; toggle.focus(); });
  addButton.addEventListener('click', () => apply(() => { add(name.value); name.value = ''; }, 'プリセットを追加しました。'));
  removeButton.addEventListener('click', () => apply(remove, 'プリセットを削除しました。'));
  buttons.append(addButton, cancel);
  group.append(label, buttons);
  container.querySelector('.api-heading').after(group, status);
  return { update(canRemove) { removeButton.disabled = !canRemove; status.textContent = ''; show(false); } };
}
