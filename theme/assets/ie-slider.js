/*
 * Горизонтальная листалка карточек.
 *
 * Прокрутка — родная (overflow-x + scroll-snap), поэтому свайп, трекпад,
 * колесо и клавиатура работают без нашего кода. На нас только стрелки
 * и их состояние.
 *
 * Сознательно НЕ делаем: автопрокрутку и зацикливание. Дойдя до края,
 * лента останавливается, а стрелка гаснет — это видимая граница списка,
 * а не бесконечная карусель.
 */

class IeSlider extends HTMLElement {
  #frame = null;

  connectedCallback() {
    this.track = this.querySelector('[data-slider-track]');
    if (!this.track) return;

    this.prev = this.querySelector('[data-slider-prev]');
    this.next = this.querySelector('[data-slider-next]');

    this.prev?.addEventListener('click', () => this.page(-1));
    this.next?.addEventListener('click', () => this.page(1));

    this.track.addEventListener('scroll', () => this.#schedule(), { passive: true });

    // Ширина карточек и вьюпорта меняется на ресайзе и когда догружаются
    // картинки — пересчитываем состояние стрелок по факту, а не однократно.
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => this.#schedule()).observe(this.track);
    } else {
      window.addEventListener('resize', () => this.#schedule(), { passive: true });
    }

    this.sync();
  }

  /**
   * Шаг прокрутки: целое число карточек, влезающих во вьюпорт.
   * Дробный шаг оставлял бы половину карточки на срезе.
   */
  step() {
    const slide = this.track.querySelector('[data-slider-slide]');
    if (!slide) return this.track.clientWidth;

    const styles = getComputedStyle(this.track);
    const gap = parseFloat(styles.columnGap || styles.gap) || 0;
    const slideWidth = slide.getBoundingClientRect().width + gap;
    if (!slideWidth) return this.track.clientWidth;

    const fit = Math.floor(this.track.clientWidth / slideWidth);
    return slideWidth * Math.max(1, fit);
  }

  page(direction) {
    this.track.scrollBy({ left: direction * this.step(), behavior: 'smooth' });
  }

  #schedule() {
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = null;
      this.sync();
    });
  }

  /** Гасим стрелку на краю: списку некуда листать дальше. */
  sync() {
    const max = this.track.scrollWidth - this.track.clientWidth;
    const position = this.track.scrollLeft;
    // Округления браузера дают доли пикселя — берём запас.
    const scrollable = max > 1;

    this.toggleAttribute('data-scrollable', scrollable);

    if (this.prev) this.prev.disabled = !scrollable || position <= 1;
    if (this.next) this.next.disabled = !scrollable || position >= max - 1;
  }
}

if (!customElements.get('ie-slider')) {
  customElements.define('ie-slider', IeSlider);
}
