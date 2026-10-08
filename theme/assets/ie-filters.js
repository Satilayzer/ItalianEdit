/**
 * Поведение панели фильтров Italian Edit (snippets/ie-filters.liquid).
 *
 * Сами запросы к Shopify и перерисовку делает facets-form-component темы
 * (assets/facets.js): мы только решаем, КОГДА звать его updateFilters().
 *
 * ПК: выбор применяется сразу. Выпадашки — <details>; открыта всегда одна,
 * клик мимо и Esc закрывают. Состояние open переживает перерисовку секции:
 * morph темы переносит его со старого <details> на новый.
 *
 * Телефон: в шторке выбор копится, счётчик «N Items» подтягивается запросом
 * той же секции с будущими параметрами, а применяется всё по APPLY.
 * Закрыли без APPLY — несохранённый выбор пропадает: при каждом открытии
 * форма сбрасывается к состоянию страницы (reset() берёт отметки из разметки
 * сервера). Сброс именно при открытии, а не по событию close: так он не
 * зависит от того, как шторку закрыли — крестиком, Esc или тапом мимо.
 */

/** @param {Element | null} el */
const facetsFormOf = (el) => /** @type {any} */ (el?.closest('facets-form-component'));

class IeFilters extends HTMLElement {
  /** @type {AbortController | null} */
  #countRequest = null;
  /** @type {number | undefined} */
  #countTimer;

  connectedCallback() {
    this.addEventListener('change', this.#onChange);
    this.addEventListener('click', this.#onClick);
    this.addEventListener('input', this.#onInput);
    this.addEventListener('submit', this.#onSubmit);
    this.addEventListener('keydown', this.#onKeyDown);
    this.addEventListener('toggle', this.#onToggle, true);
    document.addEventListener('click', this.#onDocumentClick);
  }

  disconnectedCallback() {
    document.removeEventListener('click', this.#onDocumentClick);
    this.#countRequest?.abort();
  }

  get sheet() {
    return /** @type {HTMLDialogElement | null} */ (this.querySelector('.ie-sheet'));
  }

  get mobileForm() {
    return /** @type {HTMLFormElement | null} */ (this.querySelector('[data-ie-form="mobile"]'));
  }

  /* ── События ── */

  /** @param {Event} event */
  #onChange = (event) => {
    const target = /** @type {HTMLInputElement} */ (event.target);
    if (!(target instanceof HTMLInputElement)) return;
    // Сортировка на ПК — компонент темы, он применяет её сам.
    if (target.closest('sorting-filter-component')) return;
    if (target.matches('[data-ie-search]')) return;
    // Плитки/список — переключатель вида сетки, к фильтрам не относится.
    if (target.closest('.column-options-wrapper')) return;

    const form = target.form;
    if (!form?.matches('[data-ie-form]')) return;

    if (target.matches('[data-ie-band]')) this.#syncPrice(target.closest('[data-ie-price]'));

    if (form.dataset.ieForm === 'desktop') {
      facetsFormOf(form)?.updateFilters();
    } else {
      this.#syncAccordionCount(target);
      this.#scheduleCount();
    }
  };

  /** @param {MouseEvent} event */
  #onClick = (event) => {
    const target = /** @type {Element} */ (event.target);

    const link = target.closest('a[data-ie-url]');
    if (link instanceof HTMLAnchorElement) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      const facetsForm = this.querySelector('.ie-filters__desktop');
      if (!facetsForm || typeof (/** @type {any} */ (facetsForm).updateFiltersByURL) !== 'function') return;
      event.preventDefault();
      this.#closeDropdowns();
      /** @type {any} */ (facetsForm).updateFiltersByURL(link.href);
      return;
    }

    if (target.closest('[data-ie-open]')) {
      this.#openSheet();
      return;
    }
    if (target.closest('[data-ie-close]')) {
      this.sheet?.close();
      return;
    }
    if (target.closest('[data-ie-clear]')) {
      this.#clearMobile();
      return;
    }
    if (target.closest('[data-ie-apply]')) {
      this.#apply();
      return;
    }
    // Клик по затемнению вокруг шторки (сам <dialog>, а не его содержимое).
    if (target === this.sheet) this.sheet.close();
  };

  /** Поиск по длинному списку (дизайнеры) — прячем строки, не трогая выбор. */
  /** @param {Event} event */
  #onInput = (event) => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    if (!input.matches?.('[data-ie-search]')) return;
    const query = input.value.trim().toLowerCase();
    const list = input.parentElement?.querySelector('.ie-opts');
    list?.querySelectorAll('[data-ie-label]').forEach((label) => {
      const li = label.closest('li');
      if (li) li.hidden = query !== '' && !(label.getAttribute('data-ie-label') ?? '').includes(query);
    });
  };

  /** Enter в поле поиска не должен отправлять форму обычным переходом. */
  /** @param {SubmitEvent} event */
  #onSubmit = (event) => {
    event.preventDefault();
  };

  /** @param {KeyboardEvent} event */
  #onKeyDown = (event) => {
    if (event.key === 'Escape' && this.querySelector('.ie-dd[open]')) {
      const open = this.querySelector('.ie-dd[open]');
      this.#closeDropdowns();
      /** @type {HTMLElement | null} */ (open?.querySelector('summary'))?.focus();
    }
  };

  /** Открыли одну выпадашку (или пункт аккордеона) — закрываем остальные. */
  /** @param {Event} event */
  #onToggle = (event) => {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement) || !details.open) return;
    const selector = details.matches('.ie-dd') ? '.ie-dd[open]' : details.matches('.ie-acc') ? '.ie-acc[open]' : null;
    if (!selector) return;
    this.querySelectorAll(selector).forEach((other) => {
      if (other !== details) /** @type {HTMLDetailsElement} */ (other).open = false;
    });
    const search = details.querySelector('[data-ie-search]');
    if (search instanceof HTMLInputElement && details.matches('.ie-dd')) search.focus({ preventScroll: true });
  };

  /** @param {MouseEvent} event */
  #onDocumentClick = (event) => {
    const target = /** @type {Element} */ (event.target);
    if (target.closest?.('.ie-dd')) return;
    this.#closeDropdowns();
  };

  /* ── Действия ── */

  #closeDropdowns() {
    this.querySelectorAll('.ie-dd[open]').forEach((d) => (/** @type {HTMLDetailsElement} */ (d).open = false));
  }

  /** Открыть шторку с формой, сброшенной к тому, что сейчас на странице. */
  #openSheet() {
    const form = this.mobileForm;
    const sheet = this.sheet;
    if (!form || !sheet) return;
    form.reset();
    form.querySelectorAll('[data-ie-price]').forEach((price) => this.#syncPrice(price));
    form.querySelectorAll('.ie-acc').forEach((acc) => {
      const input = acc.querySelector('input');
      if (input) this.#syncAccordionCount(/** @type {HTMLInputElement} */ (input));
    });
    this.#countRequest?.abort();
    this.#setSheetCount(null);
    sheet.showModal();
  }

  #apply() {
    const form = this.mobileForm;
    const sheet = this.sheet;
    if (!form || !sheet) return;
    this.#countRequest?.abort();
    facetsFormOf(form)?.updateFilters();
    sheet.close();
  }

  #clearMobile() {
    const form = this.mobileForm;
    if (!form) return;
    form.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      /** @type {HTMLInputElement} */ (input).checked = false;
    });
    form.querySelectorAll('[data-ie-price]').forEach((price) => this.#syncPrice(price));
    form.querySelectorAll('[data-ie-acc-count]').forEach((badge) => {
      /** @type {HTMLElement} */ (badge).hidden = true;
    });
    this.#scheduleCount();
  }

  /**
   * Отмеченные диапазоны цены → один интервал: от меньшего «от» до большего «до».
   * Открытый сверху диапазон («5000+») снимает верхнюю границу.
   * @param {Element | null} price
   */
  #syncPrice(price) {
    if (!price) return;
    const min = /** @type {HTMLInputElement | null} */ (price.querySelector('[data-ie-price-min]'));
    const max = /** @type {HTMLInputElement | null} */ (price.querySelector('[data-ie-price-max]'));
    if (!min || !max) return;

    const bands = [...price.querySelectorAll('[data-ie-band]:checked')].map((input) => ({
      lo: Number(input.getAttribute('data-lo') || 0),
      hi: input.getAttribute('data-hi') ? Number(input.getAttribute('data-hi')) : Infinity,
    }));

    if (bands.length === 0) {
      min.value = '';
      max.value = '';
      return;
    }
    const lo = Math.min(...bands.map((b) => b.lo));
    const hi = Math.max(...bands.map((b) => b.hi));
    min.value = lo > 0 ? String(lo) : '';
    max.value = Number.isFinite(hi) ? String(hi) : '';
  }

  /** Число выбранного у пункта аккордеона в шторке. */
  /** @param {HTMLInputElement} input */
  #syncAccordionCount(input) {
    const acc = input.closest('.ie-acc');
    const badge = /** @type {HTMLElement | null} */ (acc?.querySelector('[data-ie-acc-count]'));
    if (!acc || !badge) return;
    const isPrice = Boolean(acc.querySelector('[data-ie-price]'));
    const checked = acc.querySelectorAll('input[type="checkbox"]:checked').length;
    const count = isPrice ? Math.min(checked, 1) : checked;
    badge.textContent = String(count);
    badge.hidden = count === 0;
  }

  /* ── Счётчик товаров в шторке ── */

  #scheduleCount() {
    clearTimeout(this.#countTimer);
    this.#countTimer = window.setTimeout(() => this.#fetchCount(), 250);
  }

  async #fetchCount() {
    const form = this.mobileForm;
    const facetsForm = facetsFormOf(form);
    if (!form || !facetsForm) return;

    this.#countRequest?.abort();
    const request = new AbortController();
    this.#countRequest = request;

    const params = facetsForm.createURLParameters(new FormData(form));
    params.set('section_id', this.dataset.sectionId ?? '');
    const url = `${window.location.pathname}?${params.toString()}`;

    this.querySelector('[data-ie-sheet-count]')?.classList.add('is-loading');
    try {
      const response = await fetch(url, { signal: request.signal });
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const label = doc.querySelector('[data-ie-sheet-count]')?.textContent?.trim();
      if (label) this.#setSheetCount(label);
    } catch (error) {
      if (/** @type {Error} */ (error).name !== 'AbortError') this.#setSheetCount(null);
    } finally {
      if (this.#countRequest === request) {
        this.querySelector('[data-ie-sheet-count]')?.classList.remove('is-loading');
      }
    }
  }

  /** @param {string | null} label - null: вернуть счётчик страницы */
  #setSheetCount(label) {
    const count = this.querySelector('[data-ie-sheet-count]');
    if (!count) return;
    if (label === null) {
      count.textContent = this.querySelector('.ie-bar__count')?.textContent?.trim() ?? count.textContent;
      count.classList.remove('is-loading');
      return;
    }
    count.textContent = label;
  }
}

if (!customElements.get('ie-filters')) customElements.define('ie-filters', IeFilters);
