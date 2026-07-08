export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

export function normalizePastedImageFile(file: File | Blob): File {
  if (file instanceof File) {
    if (file.type.startsWith('image/')) return file;
    return new File([file], file.name || 'pasted-chart.png', { type: 'image/png' });
  }
  return new File([file], 'pasted-chart.png', { type: 'image/png' });
}

export function getImageFromClipboardEvent(event: ClipboardEvent): File | null {
  const data = event.clipboardData;
  if (!data) return null;

  if (data.files?.length) {
    for (let i = 0; i < data.files.length; i++) {
      const file = data.files[i];
      if (file.type.startsWith('image/')) {
        return normalizePastedImageFile(file);
      }
    }
  }

  const items = data.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) return normalizePastedImageFile(blob);
      }
    }
  }

  return null;
}

export const CHART_PASTE_EVENT = 'nexus-chart-paste';

export function dispatchChartPaste(file: File) {
  window.dispatchEvent(new CustomEvent<File>(CHART_PASTE_EVENT, { detail: file }));
}
