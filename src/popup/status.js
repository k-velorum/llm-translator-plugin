export function showStatus(element, message, isSuccess, { autoHide = true } = {}) {
  element.textContent = message;
  element.classList.remove('hidden', 'success', 'error');
  element.classList.add(isSuccess ? 'success' : 'error');
  if (isSuccess && autoHide) {
    setTimeout(() => element.classList.add('hidden'), 3000);
  }
}

export function showPendingStatus(element, message) {
  element.textContent = message;
  element.classList.remove('hidden', 'success', 'error');
}
