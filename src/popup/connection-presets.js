// 追加・削除は接続フォームの下書きに適用し、通常の「変更を保存」で確定する。
export function mountPresetControls(select, { add, remove, container }) {
  const group = document.createElement('details');
  group.className = 'connection-details preset-controls';
  const summary = document.createElement('summary');
  summary.textContent = 'プリセットを管理';
  group.appendChild(summary);
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
  addButton.textContent = '現在の設定を追加';
  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'btn-secondary';
  removeButton.textContent = '選択中を削除';
  const status = document.createElement('div');
  status.className = 'note';
  status.setAttribute('role', 'status');
  function apply(action, message) {
    try {
      action();
      status.textContent = `${message}「変更を保存」で確定します。`;
      select.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (error) { status.textContent = error.message; }
  }
  addButton.addEventListener('click', () => apply(() => { add(name.value); name.value = ''; }, 'プリセットを追加しました。'));
  removeButton.addEventListener('click', () => apply(remove, 'プリセットを削除しました。'));
  buttons.append(addButton, removeButton);
  group.append(label, buttons, status);
  container.querySelector('.api-heading').after(group);
  return { update(canRemove) { removeButton.disabled = !canRemove; status.textContent = ''; } };
}
