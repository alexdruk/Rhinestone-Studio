/**
 * Generic Lightbox/dialog controller — UI-001, extended by S-105.
 *
 * Pure DOM dialog behavior only: open/close, focus trap, Escape-to-close, backdrop click,
 * header drag-to-move with viewport clamping, single-primary-Lightbox exclusivity, and ARIA
 * wiring. Zero knowledge of Project, Layer, StoneLayout, or any layer type — matching every
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
// S-105: Lightboxes constructed with `options.primary=true` are mutually exclusive -- opening one
// closes any other currently-open primary Lightbox first. See docs/specifications/
// S-105-PersistentMovableLightboxes.md, "Architecture Decision: One Primary Lightbox at a Time"
// (the existing FIELD_GROUPS shared-field-DOM relocation in app.js only supports one active owner).
let primaryLightboxes = [];
// S-105: every Lightbox that has ever been dragged is tracked here so a single shared `resize`
// listener can re-clamp its position into the current viewport (a dialog dragged near an edge must
// never become unreachable after the browser window shrinks).
let draggedLightboxes = [];
let resizeListenerAttached = false;

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
 * @param {boolean} [options.primary] When true, opening this Lightbox closes any other currently
 *   open `primary` Lightbox first (S-105 single-active-primary policy).
 */
export class Lightbox {
  constructor(overlayId, options = {}) {
    this.overlay = document.getElementById(overlayId);
    if (!this.overlay) throw new Error(`Lightbox: no element with id="${overlayId}"`);
    this.dialog = this.overlay.querySelector('.lightbox');
    this.header = this.overlay.querySelector('.lightbox-header');
    this.onOpen = options.onOpen || null;
    this.onClose = options.onClose || null;
    this.primary = !!options.primary;
    this._previouslyFocused = null;
    this._handleKeydown = this._handleKeydown.bind(this);
    this._dragPointerId = null;
    this._dragOffsetX = 0;
    this._dragOffsetY = 0;

    if (this.primary) primaryLightboxes.push(this);

    const closeButtons = this.overlay.querySelectorAll('[data-lightbox-close]');
    for (const btn of closeButtons) btn.addEventListener('click', () => this.close());

    this.overlay.addEventListener('mousedown', (e) => {
      if (e.target === this.overlay) this.close();
    });

    if (this.header) {
      this.header.addEventListener('pointerdown', (e) => this._handleDragStart(e));
      this.header.addEventListener('pointermove', (e) => this._handleDragMove(e));
      this.header.addEventListener('pointerup', (e) => this._handleDragEnd(e));
      this.header.addEventListener('pointercancel', (e) => this._handleDragEnd(e));
    }

    if (!resizeListenerAttached) {
      resizeListenerAttached = true;
      window.addEventListener('resize', () => {
        for (const lb of draggedLightboxes) lb._reclampToViewport();
      });
    }
  }

  get isOpen() {
    return this.overlay.style.display !== 'none' && this.overlay.classList.contains('open');
  }

  open() {
    if (this.isOpen) return;
    if (this.primary) {
      for (const lb of primaryLightboxes) if (lb !== this && lb.isOpen) lb.close();
    }
    this._previouslyFocused = document.activeElement;
    this.overlay.style.display = 'flex';
    this.overlay.classList.add('open');
    document.addEventListener('keydown', this._handleKeydown, true);
    openLightboxes.push(this);
    this._reclampToViewport();
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

  // ---- S-105: header drag-to-move, clamped to the viewport ----

  _handleDragStart(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('button, a, input, select, textarea, [data-lightbox-close]')) return;
    // Without this, the browser's own default action for a mousedown/pointerdown that moves over
    // text (the header's <h2> title) can start a native text-selection drag instead of -- or
    // racing with -- this custom drag, on real hardware input (trackpad/mouse) even though
    // synthetic/CDP-dispatched mouse events in headless testing don't reliably reproduce it.
    e.preventDefault();
    const rect = this.dialog.getBoundingClientRect();
    this.dialog.style.position = 'fixed';
    this.dialog.style.margin = '0';
    this.dialog.style.left = `${rect.left}px`;
    this.dialog.style.top = `${rect.top}px`;
    this._dragOffsetX = e.clientX - rect.left;
    this._dragOffsetY = e.clientY - rect.top;
    this._dragPointerId = e.pointerId;
    this.header.setPointerCapture(e.pointerId);
    this.dialog.classList.add('dragging');
    if (!draggedLightboxes.includes(this)) draggedLightboxes.push(this);
  }

  _handleDragMove(e) {
    if (this._dragPointerId === null || e.pointerId !== this._dragPointerId) return;
    const { left, top } = this._clampToViewport(e.clientX - this._dragOffsetX, e.clientY - this._dragOffsetY);
    this.dialog.style.left = `${left}px`;
    this.dialog.style.top = `${top}px`;
  }

  _handleDragEnd(e) {
    if (this._dragPointerId === null || e.pointerId !== this._dragPointerId) return;
    this.header.releasePointerCapture(e.pointerId);
    this._dragPointerId = null;
    this.dialog.classList.remove('dragging');
  }

  _clampToViewport(left, top) {
    const w = this.dialog.offsetWidth;
    const h = this.dialog.offsetHeight;
    const maxLeft = Math.max(0, window.innerWidth - w);
    const minLeft = Math.min(0, window.innerWidth - w);
    const maxTop = Math.max(0, window.innerHeight - h);
    const minTop = Math.min(0, window.innerHeight - h);
    return {
      left: Math.min(maxLeft, Math.max(minLeft, left)),
      top: Math.min(maxTop, Math.max(minTop, top))
    };
  }

  _reclampToViewport() {
    if (this.dialog.style.position !== 'fixed') return;
    const left = parseFloat(this.dialog.style.left) || 0;
    const top = parseFloat(this.dialog.style.top) || 0;
    const clamped = this._clampToViewport(left, top);
    this.dialog.style.left = `${clamped.left}px`;
    this.dialog.style.top = `${clamped.top}px`;
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
