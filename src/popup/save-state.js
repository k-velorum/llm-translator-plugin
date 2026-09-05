// タブを移動しても保存状態を維持し、保存中に加えた変更を保存済みにしない。
export function createSaveState({ saveButton, saveState, statusMessage }, persist) {
  let revision = 0;
  let savedRevision = 0;
  let saving = false;

  function render() {
    const dirty = revision !== savedRevision;
    saveButton.disabled = saving || !dirty;
    saveButton.textContent = saving ? '保存中…' : '変更を保存';
    saveState.textContent = saving ? '設定を保存しています' : dirty ? '未保存の変更があります' : 'すべて保存済み';
    saveState.dataset.state = dirty ? 'dirty' : 'saved';
  }

  function markDirty() {
    revision += 1;
    statusMessage.textContent = '';
    statusMessage.classList.add('hidden');
    render();
  }

  async function save() {
    if (saving || revision === savedRevision) return;
    const pendingRevision = revision;
    saving = true;
    render();
    try {
      await persist();
      savedRevision = pendingRevision;
      statusMessage.textContent = '';
      statusMessage.classList.add('hidden');
    } catch (error) {
      statusMessage.textContent = error?.message || '保存できませんでした。もう一度お試しください。';
      statusMessage.classList.remove('hidden');
    } finally {
      saving = false;
      render();
    }
  }

  render();
  saveButton.addEventListener('click', save);
  return { markDirty, save };
}
