/*
 * Листалка карточек: горизонтальная по умолчанию, вертикальная при
 * data-axis="y".
 *
 * Прокрутка — родная (overflow + scroll-snap), поэтому свайп пальцем,
 * трекпад, колесо и клавиатура работают без нашего кода. Мы добавляем
 * только две вещи: состояние стрелок и перетаскивание мышью — на десктопе
 * родного «свайпа» нет.
 *
 * Сознательно НЕ делаем: автопрокрутку и зацикливание. Дойдя до края,
 * лента останавливается, а стрелка пропадает — это видимая граница списка,
 * а не бесконечная карусель.
 */

/** Сдвиг курсора, после которого это уже перетаскивание, а не клик. */
const DRAG_THRESHOLD = 4;

/*
 * Вся разница между горизонтальной и вертикальной лентой собрана здесь,
 * чтобы стрелки, шаг и перетаскивание считались одним кодом на обе оси.
 */
const AXES = {
  x: {
    offset: 'scrollLeft',
    viewport: 'clientWidth',
    gap: (styles) => parseFloat(styles.columnGap || styles.gap) || 0,
    extent: (rect) => rect.width,
    pointer: (event) => event.clientX,
    by: (distance) => ({ left: distance, behavior: 'smooth' }),
    atStart: (first, view, edge) => first.left >= view.left - edge,
    atEnd: (last, view, edge) => last.right <= view.right + edge,
  },
  y: {
    offset: 'scrollTop',
    viewport: 'clientHeight',
    gap: (styles) => parseFloat(styles.rowGap || styles.gap) || 0,
    extent: (rect) => rect.height,
    pointer: (event) => event.clientY,
    by: (distance) => ({ top: distance, behavior: 'smooth' }),
    atStart: (first, view, edge) => first.top >= view.top - edge,
    atEnd: (last, view, edge) => last.bottom <= view.bottom + edge,
  },
};

class IeSlider extends HTMLElement {
  #frame = null;
  #drag = null;
  #suppressClick = false;

  connectedCallback() {
    this.track = this.querySelector('[data-slider-track]');
    if (!this.track) return;

    this.axis = AXES[this.getAttribute('data-axis') === 'y' ? 'y' : 'x'];

    this.prev = this.querySelector('[data-slider-prev]');
    this.next = this.querySelector('[data-slider-next]');

    this.prev?.addEventListener('click', () => this.page(-1));
    this.next?.addEventListener('click', () => this.page(1));

    this.track.addEventListener('scroll', () => this.#schedule(), { passive: true });

    // Размер карточек и вьюпорта меняется на ресайзе и когда догружаются
    // картинки — пересчитываем состояние стрелок по факту, а не однократно.
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => this.#schedule()).observe(this.track);
    } else {
      window.addEventListener('resize', () => this.#schedule(), { passive: true });
    }

    this.#setupDrag();
    this.sync();
  }

  /**
   * Шаг прокрутки: целое число карточек, влезающих во вьюпорт.
   * Дробный шаг оставлял бы половину карточки на срезе.
   */
  step() {
    const slide = this.track.querySelector('[data-slider-slide]');
    if (!slide) return this.track[this.axis.viewport];

    const styles = getComputedStyle(this.track);
    const gap = this.axis.gap(styles);
    const slideSize = this.axis.extent(slide.getBoundingClientRect()) + gap;
    if (!slideSize) return this.track[this.axis.viewport];

    const fit = Math.floor(this.track[this.axis.viewport] / slideSize);
    return slideSize * Math.max(1, fit);
  }

  page(direction) {
    this.track.scrollBy(this.axis.by(direction * this.step()));
  }

  /**
   * Перетаскивание мышью. Тач и перо не трогаем: там прокрутка родная,
   * и вмешательство только испортит инерцию.
   */
  #setupDrag() {
    const track = this.track;

    // Картинки и ссылки браузер тащит сам — это перебивает наше перетаскивание.
    track.addEventListener('dragstart', (event) => event.preventDefault());

    track.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;

      this.#suppressClick = false;
      this.#drag = {
        start: this.axis.pointer(event),
        from: track[this.axis.offset],
        moved: false,
        id: event.pointerId,
      };

      // Пока тянем, лента должна идти за курсором один в один:
      // плавность и прилипание тут только мешают.
      track.style.scrollBehavior = 'auto';
      track.style.scrollSnapType = 'none';
    });

    track.addEventListener('pointermove', (event) => {
      if (!this.#drag || event.pointerId !== this.#drag.id) return;

      const delta = this.axis.pointer(event) - this.#drag.start;
      if (!this.#drag.moved) {
        if (Math.abs(delta) < DRAG_THRESHOLD) return;
        this.#drag.moved = true;
        this.toggleAttribute('data-dragging', true);
        // Захват курсора берём только когда это точно перетаскивание,
        // иначе обычный клик по карточке начнёт теряться.
        track.setPointerCapture(event.pointerId);
      }

      track[this.axis.offset] = this.#drag.from - delta;
      event.preventDefault();
    });

    const finish = (event) => {
      if (!this.#drag || (event && event.pointerId !== this.#drag.id)) return;

      const { moved, id } = this.#drag;
      this.#drag = null;

      if (track.hasPointerCapture(id)) track.releasePointerCapture(id);

      // Возвращаем прилипание — лента доедет до ближайшей карточки.
      track.style.scrollBehavior = '';
      track.style.scrollSnapType = '';
      this.toggleAttribute('data-dragging', false);

      // После перетаскивания браузер всё равно шлёт click по карточке —
      // гасим его, чтобы протяжка не открывала страницу.
      this.#suppressClick = moved;
    };

    track.addEventListener('pointerup', finish);
    track.addEventListener('pointercancel', finish);

    track.addEventListener(
      'click',
      (event) => {
        if (!this.#suppressClick) return;
        this.#suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
      },
      true
    );
  }

  #schedule() {
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = null;
      this.sync();
    });
  }

  /**
   * Прячем стрелку на краю: списку некуда листать дальше.
   *
   * Считаем не по scrollLeft/scrollTop. У ленты есть поля по краям, и
   * прилипание оставляет её в начале не на нуле, а на ширине поля —
   * сравнение с нулём держало бы первую стрелку видимой всегда. Смотрим
   * на сами карточки: край достигнут, когда первая (последняя) целиком
   * во вьюпорте.
   */
  sync() {
    const slides = this.track.querySelectorAll('[data-slider-slide]');
    const view = this.track.getBoundingClientRect();
    const first = slides[0]?.getBoundingClientRect();
    const last = slides[slides.length - 1]?.getBoundingClientRect();

    // Округления браузера дают доли пикселя — берём запас.
    const EDGE = 2;
    const atStart = !first || this.axis.atStart(first, view, EDGE);
    const atEnd = !last || this.axis.atEnd(last, view, EDGE);

    // Обе стрелки лишние, только когда карточки влезли целиком.
    this.toggleAttribute('data-scrollable', !(atStart && atEnd));

    if (this.prev) this.prev.disabled = atStart;
    if (this.next) this.next.disabled = atEnd;
  }
}

if (!customElements.get('ie-slider')) {
  customElements.define('ie-slider', IeSlider);
}
