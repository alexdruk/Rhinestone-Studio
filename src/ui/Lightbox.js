/**
 * Generic Lightbox/dialog controller — UI-001.
 *
 * Pure DOM dialog behavior only: open/close, focus trap, Escape-to-close, backdrop click, and
 * ARIA wiring. Zero knowledge of Project, Layer, StoneLayout, or any layer type — matching every
 * other permanent module's "consumed only through its barrel" shape (src/editing/**,
 * src/history/**, ...). app.js is the only caller; it supplies the actual field markup already in
 * the DOM (this module never creates layer-aware content) and its own Apply/Cancel callbacks.
 *
 * One Lightbox instance wraps one `.lightbox-overlay` element already present in index.html, with
 * this fixed internal structure:
 *   <div class="lightbox-overlay" id="...">
 *     <div class="lightbox" role="dialog" aria-modal="true" aria-labelledby="...">
 *       <header class="lightbox-header">...<button class="lightbox-close">...</header>
 *       <div class="lightbox-body">...</div>
 *       <footer class="lightbox-footer">...Cancel/Apply buttons...</footer>
 *     </div>
 *   </div>
 */

let openLightboxes = [];

function focusableElements(root) {
  return [...root.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/**
 * @param {string} overlayId The id of the `.lightbox-overlay` element in the DOM.
 * @param {object} [options]
 * @param {Function} [options.onOpen] Called every time the dialog opens.
 * @param {Function} [options.onClose] Called every time the dialog closes (Escape, backdrop, close
 *   button, or a caller-invoked `close()` — including after Apply). Never called on Cancel-only
 *   navigation away without a close.
 */
export class Lightbox {
  constructor(overlayId, options = {}) {
    this.overlay = document.getElementById(overlayId);
    if (!this.overlay) throw new Error(`Lightbox: no element with id="${overlayId}"`);
    this.dialog = this.overlay.querySelector('.lightbox');
    this.onOpen = options.onOpen || null;
    this.onClose = options.onClose || null;
    this._previouslyFocused = null;
    this._handleKeydown = this._handleKeydown.bind(this);

    const closeButtons = this.overlay.querySelectorAll('[data-lightbox-close]');
    for (const btn of closeButtons) btn.addEventListener('click', () => this.close());

    this.overlay.addEventListener('mousedown', (e) => {
      if (e.target === this.overlay) this.close();
    });
  }

  get isOpen() {
    return this.overlay.style.display !== 'none' && this.overlay.classList.contains('open');
  }

  open() {
    if (this.isOpen) return;
    this._previouslyFocused = document.activeElement;
    this.overlay.style.display = 'flex';
    this.overlay.classList.add('open');
    document.addEventListener('keydown', this._handleKeydown, true);
    openLightboxes.push(this);
    if (this.onOpen) this.onOpen();
    const focusables = focusableElements(this.dialog);
    (focusables[0] || this.dialog).focus({ preventScroll: true });
  }

  close() {
    if (!this.isOpen) return;
    this.overlay.style.display = 'none';
    this.overlay.classList.remove('open');
    document.removeEventListener('keydown', this._handleKeydown, true);
    openLightboxes = openLightboxes.filter((l) => l !== this);
    if (this.onClose) this.onClose();
    if (this._previouslyFocused && typeof this._previouslyFocused.focus === 'function') {
      this._previouslyFocused.focus({ preventScroll: true });
    }
  }

  _handleKeydown(e) {
    if (openLightboxes[openLightboxes.length - 1] !== this) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }
    if (e.key === 'Tab') {
      const focusables = focusableElements(this.dialog);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
}
