import { nextTick, onBeforeUnmount, watch } from 'vue';

const dialogs = [];
const focusable = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

export function useDialog(isOpen, element, close) {
  const entry = {};
  let previousFocus = null;
  function release() {
    const index = dialogs.indexOf(entry);
    if (index >= 0) dialogs.splice(index, 1);
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    previousFocus = null;
  }
  watch(isOpen, async (open) => {
    if (!open) { release(); return; }
    previousFocus = document.activeElement;
    dialogs.push(entry);
    await nextTick();
    if (!isOpen() || !element.value) return;
    (element.value.querySelector(focusable) || element.value).focus({ preventScroll: true });
  }, { flush: 'post' });
  function onKeydown(event) {
    if (!isOpen() || dialogs[dialogs.length - 1] !== entry || !element.value) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      const items = [...element.value.querySelectorAll(focusable)].filter(el => el.getClientRects().length);
      const first = items[0] || element.value;
      const last = items[items.length - 1] || element.value;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !element.value.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !element.value.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
  }
  window.addEventListener('keydown', onKeydown);
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown);
    release();
  });
}
