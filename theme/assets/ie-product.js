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
 * и полноэкранный просмотр с зумом.
 */

/** Насколько далеко надо провести пальцем, чтобы это считалось свайпом, px. */
const SWIPE_THRESHOLD = 40;

/** Во сколько раз увеличивают щелчок, тап и кнопка лупы. */
const ZOOM_STEP = 2.5;

/**
 * Потолок щипка. Исходники у товаров около 1000px: при 4× экран уже
 * показывает четверть кадра, дальше видны только пиксели.
 */
const ZOOM_MAX = 4;

/** Сдвиг пальца, после которого касание — перетаскивание, а не тап, px. */
const TAP_SLOP = 6;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

class IeProduct extends HTMLElement {
  connectedCallback() {
    this.main = this.querySelector('[data-ie-main-image]');
    this.thumbs = Array.from(this.querySelectorAll('[data-ie-thumb]'));

    this.zoom = this.querySelector('[data-ie-zoom]');
    this.zoomImage = this.querySelector('[data-ie-zoom-image]');
    this.zoomCounter = this.querySelector('[data-ie-zoom-counter]');
    this.zoomToggle = this.querySelector('[data-ie-zoom-toggle]');

    // Масштаб и сдвиг фото в просмотре. Сдвиг — от центра, в пикселях экрана.
    this.zoomScale = 1;
    this.zoomX = 0;
    this.zoomY = 0;

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

    // Стрелки у большой картинки листают тот же индекс, что лента и просмотр.
    if (event.target.closest('[data-ie-media-prev]')) {
      event.preventDefault();
      this.#step(-1);
      return;
    }
    if (event.target.closest('[data-ie-media-next]')) {
      event.preventDefault();
      this.#step(1);
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
  #bindSwipe(element, canSwipe = () => true) {
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

      // Увеличенное фото палец двигает, а не листает.
      if (!canSwipe()) {
        startX = null;
        startY = null;
        return;
      }

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
      if (event.target.closest('[data-ie-zoom-toggle]')) {
        this.#toggleZoom();
        return;
      }

      // Щелчок по самому фото — зум туда и обратно. После щипка,
      // перетаскивания или свайпа это не щелчок, а конец жеста.
      if (event.target === this.zoomImage) {
        if (!this.zoomMoved && !this.swiped) this.#toggleZoom(event);
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
      // Кроме увеличенного фото: там тап по фону сначала возвращает его
      // целиком — человек смотрел деталь, а не собирался уходить.
      if (event.target.closest('[data-ie-zoom-stage]') && event.target !== this.zoomImage) {
        if (this.zoomScale > 1) {
          if (!this.zoomMoved) this.#zoomTo(1);
          return;
        }
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
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        this.#zoomTo(ZOOM_STEP);
      }
      if (event.key === '-') {
        event.preventDefault();
        this.#zoomTo(1);
      }
    });

    // Закрыли просмотр — в следующий раз он откроется с фото целиком.
    this.zoom.addEventListener('close', () => this.#resetZoom());

    const stage = this.zoom.querySelector('[data-ie-zoom-stage]');
    this.#bindSwipe(stage, () => this.zoomScale === 1 && !this.zoomGestured);
    this.#bindZoomGestures(stage);
  }

  /*
   * Зум в просмотре.
   *
   * Мышь: щелчок увеличивает, дальше фото ходит за курсором — курсор
   * у левого края показывает левый край фото. Так смотрят вещь на
   * люксовых витринах, и ничего не надо перетаскивать.
   *
   * Палец: тап увеличивает и возвращает, щипок — плавно до ZOOM_MAX,
   * увеличенное фото ведётся пальцем. Пока фото увеличено, свайп не
   * листает (условие у #bindSwipe выше).
   */
  #bindZoomGestures(stage) {
    if (!stage) return;

    const pointers = new Map();
    let gesture = null;

    const startGesture = () => {
      const points = [...pointers.values()];
      if (points.length >= 2) {
        const [a, b] = points;
        gesture = {
          type: 'pinch',
          distance: Math.hypot(b.x - a.x, b.y - a.y) || 1,
          scale: this.zoomScale,
          mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          x: this.zoomX,
          y: this.zoomY,
        };
      } else if (points.length === 1 && this.zoomScale > 1) {
        gesture = { type: 'pan', start: { ...points[0] }, x: this.zoomX, y: this.zoomY };
      } else {
        gesture = null;
      }
    };

    stage.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse') {
        this.zoomMoved = false;
        return;
      }

      // Новое касание с чистого листа: прошлый жест кончился.
      if (pointers.size === 0) {
        this.zoomMoved = false;
        this.zoomGestured = false;
      }

      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size >= 2) this.zoomGestured = true;
      startGesture();
    });

    stage.addEventListener('pointermove', (event) => {
      // Мышь: увеличенное фото следует за курсором.
      if (event.pointerType === 'mouse') {
        if (this.zoomScale > 1) this.#followPointer(event);
        return;
      }

      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (!gesture) return;

      const points = [...pointers.values()];

      if (gesture.type === 'pinch' && points.length >= 2) {
        const [a, b] = points;
        const distance = Math.hypot(b.x - a.x, b.y - a.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this.zoomMoved = true;

        // Точка фото под серединой пальцев в начале щипка остаётся под ней
        // и дальше: так щипок одновременно и увеличивает, и двигает.
        const center = this.#zoomCenter();
        const localX = (gesture.mid.x - center.x - gesture.x) / gesture.scale;
        const localY = (gesture.mid.y - center.y - gesture.y) / gesture.scale;
        const scale = clamp((gesture.scale * distance) / gesture.distance, 1, ZOOM_MAX);

        this.zoomScale = scale;
        this.zoomX = mid.x - center.x - localX * scale;
        this.zoomY = mid.y - center.y - localY * scale;
        this.#clampZoom();
        this.#applyZoom(false);
        return;
      }

      if (gesture.type === 'pan' && points.length === 1) {
        const [point] = points;
        const dx = point.x - gesture.start.x;
        const dy = point.y - gesture.start.y;
        if (Math.hypot(dx, dy) > TAP_SLOP) this.zoomMoved = true;

        this.zoomX = gesture.x + dx;
        this.zoomY = gesture.y + dy;
        this.#clampZoom();
        this.#applyZoom(false);
      }
    });

    const release = (event) => {
      if (!pointers.delete(event.pointerId)) return;

      if (gesture?.type === 'pinch' && pointers.size < 2) {
        // Почти не увеличили — возвращаем фото целиком, а не на 1.03×.
        if (this.zoomScale < 1.05) this.#zoomTo(1);
        else this.#loadZoomSource();
      }

      // Один палец остался после щипка — он продолжает вести фото.
      startGesture();
      if (pointers.size === 0) this.#applyZoom(true);
    };

    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
  }

  /** Центр вписанного фото на экране: сцена ставит его в центр диалога. */
  #zoomCenter() {
    const box = this.zoom.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }

  /**
   * Насколько фото может уйти от центра, чтобы его край не отрывался от
   * края экрана. offsetWidth — размер без transform, то есть вписанный.
   */
  #zoomLimits() {
    const img = this.zoomImage;
    return {
      x: Math.max(0, (img.offsetWidth * this.zoomScale - this.zoom.clientWidth) / 2),
      y: Math.max(0, (img.offsetHeight * this.zoomScale - this.zoom.clientHeight) / 2),
    };
  }

  #clampZoom() {
    const limits = this.#zoomLimits();
    this.zoomX = clamp(this.zoomX, -limits.x, limits.x);
    this.zoomY = clamp(this.zoomY, -limits.y, limits.y);
  }

  /** Курсор у края экрана показывает этот же край фото. */
  #followPointer(event) {
    const box = this.zoom.getBoundingClientRect();
    const limits = this.#zoomLimits();
    const u = clamp((event.clientX - box.left) / box.width, 0, 1);
    const v = clamp((event.clientY - box.top) / box.height, 0, 1);

    this.zoomX = (0.5 - u) * 2 * limits.x;
    this.zoomY = (0.5 - v) * 2 * limits.y;
    this.#applyZoom(false);
  }

  /**
   * Увеличить до scale так, чтобы точка (x, y) экрана осталась на месте.
   * Без точки — вокруг центра (кнопка лупы, клавиши).
   */
  #zoomTo(scale, x, y) {
    const center = this.#zoomCenter();
    const px = x ?? center.x;
    const py = y ?? center.y;
    const from = this.zoomScale;
    const to = clamp(scale, 1, ZOOM_MAX);

    const localX = (px - center.x - this.zoomX) / from;
    const localY = (py - center.y - this.zoomY) / from;

    this.zoomScale = to;
    this.zoomX = to === 1 ? 0 : px - center.x - localX * to;
    this.zoomY = to === 1 ? 0 : py - center.y - localY * to;
    this.#clampZoom();

    if (to > 1) this.#loadZoomSource();
    this.#applyZoom(true);
  }

  /**
   * Туда и обратно. Для мыши сдвиг сразу считаем по курсору: иначе фото
   * встало бы по точке щелчка, а на первом же движении мыши перескочило
   * на правило «курсор у края — край фото».
   */
  #toggleZoom(event) {
    if (this.zoomScale > 1) {
      this.#zoomTo(1);
      return;
    }

    this.#zoomTo(ZOOM_STEP, event?.clientX, event?.clientY);
    if (event && this.#mouseLike(event)) this.#followPointer(event);
  }

  /**
   * Щелчок мышью или тап? У click нет pointerType в старых Safari, поэтому
   * запасной признак — устройство с наведением (там почти всегда мышь).
   */
  #mouseLike(event) {
    if (event.pointerType) return event.pointerType === 'mouse';
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  }

  #applyZoom(animate) {
    if (!this.zoomImage) return;

    const zoomed = this.zoomScale > 1;
    this.zoom.toggleAttribute('data-zoomed', zoomed);
    this.zoom.toggleAttribute('data-gesture', !animate);
    this.zoomImage.style.transform = zoomed
      ? `translate(${this.zoomX}px, ${this.zoomY}px) scale(${this.zoomScale})`
      : '';

    if (this.zoomToggle) {
      this.zoomToggle.setAttribute('aria-pressed', String(zoomed));
      const label = zoomed ? this.zoomToggle.dataset.labelOut : this.zoomToggle.dataset.labelIn;
      if (label) this.zoomToggle.setAttribute('aria-label', label);
    }
  }

  #resetZoom() {
    this.zoomScale = 1;
    this.zoomX = 0;
    this.zoomY = 0;
    this.#applyZoom(false);
  }

  /**
   * На увеличении подменяем фото на крупное (2400px). Сначала догружаем
   * копию и только потом меняем src — иначе на время загрузки просмотр
   * опустел бы. Если исходник меньше 2400, Shopify отдаст исходник,
   * и подмена ничего не испортит.
   */
  #loadZoomSource() {
    const thumb = this.thumbs[this.#currentIndex()];
    const source = thumb?.dataset.zoomSrc;
    if (!source || !this.zoomImage || this.zoomImage.dataset.zoomSrc === source) return;

    this.zoomImage.dataset.zoomSrc = source;
    const preload = new Image();
    preload.src = source;
    preload
      .decode()
      .then(() => {
        if (this.zoomImage.dataset.zoomSrc === source) this.zoomImage.src = source;
      })
      .catch(() => {});
  }

  #openZoom() {
    if (!this.zoom || typeof this.zoom.showModal !== 'function') return;
    this.#renderZoom(this.#currentIndex());
    this.zoom.showModal();
  }

  #renderZoom(index) {
    const thumb = this.thumbs[index];
    if (!this.zoomImage || !thumb) return;

    // Другое фото — снова целиком и снова обычного размера.
    this.#resetZoom();
    delete this.zoomImage.dataset.zoomSrc;

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
