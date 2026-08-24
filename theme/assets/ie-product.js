/*
 * Страница товара: выбор картинки из ленты и переключение вариантов.
 *
 * Форму «в корзину» и вишлист рисует сама тема (product-form-component,
 * wishlist-button) — их поведение мы не трогаем, только меняем значение
 * скрытого поля с вариантом и состояние кнопки.
 *
 * Цены приходят из Liquid уже отформатированными (data-ie-variants):
 * так не нужно тащить в браузер правила форматирования валют, и цена
 * в разметке и после переключения размера выглядит одинаково.
 *
 * Прокрутка ленты миниатюр — на общем ie-slider.js: стрелки, край,
 * перетаскивание мышью. Здесь только выбор картинки.
 */

class IeProduct extends HTMLElement {
  connectedCallback() {
    this.main = this.querySelector('[data-ie-main-image]');
    this.thumbs = Array.from(this.querySelectorAll('[data-ie-thumb]'));

    this.variants = this.#readVariants();
    this.variantInput = this.querySelector('input[name="id"]');

    // Клик по миниатюре ловим на всплытии: ie-slider гасит клик после
    // перетаскивания в фазе перехвата, и протяжка не выберет картинку.
    this.addEventListener('click', (event) => this.#onClick(event));
    this.addEventListener('change', (event) => this.#onChange(event));

    this.#syncThumbs(this.#currentIndex());
  }

  #readVariants() {
    const node = this.querySelector('[data-ie-variants]');
    if (!node) return [];
    try {
      return JSON.parse(node.textContent);
    } catch {
      return [];
    }
  }

  /** Индекс выбранной миниатюры — источник правды в разметке. */
  #currentIndex() {
    const current = this.thumbs.findIndex((thumb) => thumb.getAttribute('aria-current') === 'true');
    return current === -1 ? 0 : current;
  }

  #onClick(event) {
    const thumb = event.target.closest('[data-ie-thumb]');
    if (!thumb || !this.contains(thumb)) return;

    event.preventDefault();
    this.select(this.thumbs.indexOf(thumb));
  }

  select(index) {
    const thumb = this.thumbs[index];
    if (!thumb || !this.main) return;

    this.main.src = thumb.dataset.src;
    if (thumb.dataset.srcset) this.main.srcset = thumb.dataset.srcset;
    this.main.alt = thumb.dataset.alt || '';

    this.#syncThumbs(index);
  }

  /**
   * Выбранная миниатюра показывается как есть, на остальные ложится
   * серая вуаль (см. стили секции) — состояние держим на aria-current,
   * чтобы оно читалось и скринридером, а не только глазами.
   */
  #syncThumbs(index) {
    this.thumbs.forEach((thumb, i) => {
      if (i === index) {
        thumb.setAttribute('aria-current', 'true');
      } else {
        thumb.removeAttribute('aria-current');
      }
    });
  }

  #onChange(event) {
    if (!event.target.matches('[data-ie-option]')) return;
    this.#applyVariant(this.#matchVariant());
  }

  /** Ищем вариант по набору выбранных значений опций. */
  #matchVariant() {
    const chosen = Array.from(this.querySelectorAll('[data-ie-option]:checked')).map((input) => input.value);
    return this.variants.find(
      (variant) => variant.options.length === chosen.length && variant.options.every((value, i) => value === chosen[i])
    );
  }

  #applyVariant(variant) {
    this.#updateOptionLabels();

    if (!variant) {
      this.#setAvailability(false, this.dataset.textUnavailable);
      return;
    }

    if (this.variantInput) this.variantInput.value = variant.id;

    this.#setText('[data-ie-price]', variant.price);
    this.#setText('[data-ie-sku]', variant.sku);

    // Перечёркнутая цена и процент показываются только когда скидка есть.
    const compare = this.querySelector('[data-ie-compare]');
    const discount = this.querySelector('[data-ie-discount]');
    if (compare) {
      compare.textContent = variant.compare_at || '';
      compare.hidden = !variant.compare_at;
    }
    if (discount) {
      discount.textContent = variant.discount || '';
      discount.hidden = !variant.discount;
    }

    this.#setAvailability(variant.available, variant.available ? this.dataset.textAdd : this.dataset.textSoldOut);

    if (variant.media_index != null) this.select(variant.media_index);

    // Ссылку правим, а не перезагружаем страницу: так работает «назад»
    // и ссылку на конкретный размер можно скопировать.
    const url = new URL(window.location.href);
    url.searchParams.set('variant', variant.id);
    window.history.replaceState({}, '', url);
  }

  /** Подпись «Размер: 38.5» рядом с названием опции. */
  #updateOptionLabels() {
    this.querySelectorAll('[data-ie-option-group]').forEach((group) => {
      const selected = group.querySelector('[data-ie-option]:checked');
      const label = group.querySelector('[data-ie-option-value]');
      if (selected && label) label.textContent = selected.value;
    });
  }

  #setAvailability(available, text) {
    const button = this.querySelector('[data-ie-add-to-cart] button');
    if (!button) return;

    button.disabled = !available;

    const slot = button.querySelector('.add-to-cart-text__content span span');
    if (slot && text) slot.textContent = text;
  }

  #setText(selector, value) {
    const node = this.querySelector(selector);
    if (node) node.textContent = value || '';
  }
}

if (!customElements.get('ie-product')) {
  customElements.define('ie-product', IeProduct);
}
