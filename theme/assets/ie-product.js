/*
 * Страница товара: галерея и переключение вариантов.
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
 * перетаскивание мышью. Здесь выбор фотографии, свайп по большой картинке
 * и полноэкранный просмотр.
 */

/** Насколько далеко надо провести пальцем, чтобы это считалось свайпом, px. */
const SWIPE_THRESHOLD = 40;

class IeProduct extends HTMLElement {
  connectedCallback() {
    this.main = this.querySelector('[data-ie-main-image]');
    this.thumbs = Array.from(this.querySelectorAll('[data-ie-thumb]'));

    this.zoom = this.querySelector('[data-ie-zoom]');
    this.zoomImage = this.querySelector('[data-ie-zoom-image]');
    this.zoomCounter = this.querySelector('[data-ie-zoom-counter]');

    this.variants = this.#readVariants();
    this.variantInput = this.querySelector('input[name="id"]');

    /*
     * Номер последнего запрошенного кадра. Пока грузится одна фотография,
     * покупатель успевает ткнуть в следующую — и без этой метки первая,
     * догрузившись, перебила бы вторую.
     */
    this.pending = 0;

    // Клик по миниатюре ловим на всплытии: ie-slider гасит клик после
    // перетаскивания в фазе перехвата, и протяжка не выберет картинку.
    this.addEventListener('click', (event) => this.#onClick(event));
    this.addEventListener('change', (event) => this.#onChange(event));

    this.#bindSwipe(this.main);
    this.#bindZoom();

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
    if (thumb && this.contains(thumb)) {
      event.preventDefault();
      this.select(this.thumbs.indexOf(thumb));
      return;
    }

    // Клик по большой картинке — полноэкранный просмотр. После свайпа его
    // не открываем: палец уехал в сторону, значит листали, а не нажимали.
    if (this.main && event.target === this.main && !this.swiped) {
      event.preventDefault();
      this.#openZoom();
    }
  }

  /**
   * Показать фотографию под номером index.
   *
   * Картинку сначала догружаем невидимой копией и только потом подменяем
   * src у видимой. Иначе браузер на время загрузки оставляет элемент
   * пустым — на телефоне это выглядело как серый экран при каждом
   * переключении фотографии.
   *
   * decode() ждёт именно тот кадр, который браузер выберет из srcset:
   * копии отдаём те же srcset и sizes, поэтому к моменту подмены нужный
   * размер уже лежит в кеше.
   */
  async select(index) {
    const thumb = this.thumbs[index];
    if (!thumb || !this.main) return;

    const src = thumb.dataset.src;
    const srcset = thumb.dataset.srcset || '';
    const alt = thumb.dataset.alt || '';

    // Миниатюры переключаем сразу: отклик на нажатие важнее того, что
    // большая картинка появится на десяток миллисекунд позже.
    this.#syncThumbs(index);
    if (this.zoom?.open) this.#renderZoom(index);

    if (this.main.src === src) return;

    const token = ++this.pending;

    try {
      const preload = new Image();
      preload.sizes = this.main.sizes;
      if (srcset) preload.srcset = srcset;
      preload.src = src;
      await preload.decode();
    } catch {
      // Картинка не загрузилась или decode не поддержан — ставим как есть.
    }

    // За время загрузки выбрали другую фотографию: эта уже не нужна.
    if (token !== this.pending) return;

    if (srcset) this.main.srcset = srcset;
    this.main.src = src;
    this.main.alt = alt;
  }

  /** Листание по кругу: с последней фотографии — снова на первую. */
  #step(delta) {
    if (this.thumbs.length < 2) return;
    const next = (this.#currentIndex() + delta + this.thumbs.length) % this.thumbs.length;
    this.select(next);
  }

  /**
   * Горизонтальный свайп по элементу листает фотографии.
   *
   * Слушаем pointer-события, а не touch: одним кодом покрываются палец,
   * мышь и перо. Вертикальную прокрутку не забираем — за это отвечает
   * touch-action: pan-y в стилях.
   */
  #bindSwipe(element) {
    if (!element) return;

    let startX = null;
    let startY = null;

    element.addEventListener('pointerdown', (event) => {
      startX = event.clientX;
      startY = event.clientY;
      this.swiped = false;
    });

    const finish = (event) => {
      if (startX === null) return;

      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      startX = null;
      startY = null;

      // Если увели больше по вертикали — это прокрутка страницы, не свайп.
      if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return;

      this.swiped = true;
      this.#step(dx < 0 ? 1 : -1);
    };

    element.addEventListener('pointerup', finish);
    element.addEventListener('pointercancel', () => {
      startX = null;
      startY = null;
    });
  }

  /*
   * Полноэкранный просмотр.
   *
   * Открытие и закрытие отдаём родному <dialog>: showModal сам ставит
   * затемнение, запирает прокрутку страницы, держит фокус внутри и
   * закрывается по Esc. Нам остаются стрелки, свайп и подпись со счётчиком.
   */
  #bindZoom() {
    if (!this.zoom) return;

    this.zoom.addEventListener('click', (event) => {
      if (event.target.closest('[data-ie-zoom-close]')) {
        this.zoom.close();
        return;
      }
      if (event.target.closest('[data-ie-zoom-prev]')) {
        this.#step(-1);
        return;
      }
      if (event.target.closest('[data-ie-zoom-next]')) {
        this.#step(1);
        return;
      }

      // Клик мимо картинки — тоже закрытие: так ведут себя все просмотрщики.
      if (event.target.closest('[data-ie-zoom-stage]') && event.target !== this.zoomImage) {
        this.zoom.close();
      }
    });

    this.zoom.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        this.#step(1);
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        this.#step(-1);
      }
    });

    this.#bindSwipe(this.zoom.querySelector('[data-ie-zoom-stage]'));
  }

  #openZoom() {
    if (!this.zoom || typeof this.zoom.showModal !== 'function') return;
    this.#renderZoom(this.#currentIndex());
    this.zoom.showModal();
  }

  #renderZoom(index) {
    const thumb = this.thumbs[index];
    if (!this.zoomImage || !thumb) return;

    this.zoomImage.src = thumb.dataset.src;
    this.zoomImage.alt = thumb.dataset.alt || '';

    if (this.zoomCounter) {
      this.zoomCounter.textContent = `${index + 1} / ${this.thumbs.length}`;
    }
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

  /** Выбранное значение опции. */
  #optionValue(group) {
    const checked = group.querySelector('input[data-ie-option]:checked');
    return checked ? checked.value : null;
  }

  /** Ищем вариант по набору выбранных значений опций. */
  #matchVariant() {
    // Порядок групп в разметке совпадает с порядком опций у варианта.
    const chosen = Array.from(this.querySelectorAll('[data-ie-option-group]')).map((group) =>
      this.#optionValue(group)
    );
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
      const label = group.querySelector('[data-ie-option-value]');
      if (!label) return;

      const value = this.#optionValue(group);
      if (value != null) label.textContent = value;
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
