/*
 * Звук витрины Italian Edit.
 *
 * Одна кнопка в шапке глушит и включает весь звук на сайте, ползунок рядом
 * задаёт громкость. Состояние лежит в localStorage, поэтому переживает
 * переходы между страницами: включил звук на главной — он играет и дальше.
 *
 * Под управление попадают все <audio> и <video>, кроме двух случаев:
 *   • data-ie-sound="ignore" — явное исключение;
 *   • фоновое видео (<video autoplay muted>) — оно немое по замыслу,
 *     и включать ему звук вместе с музыкой нельзя.
 *
 * Элемент с data-ie-sound-autoplay="true" (фоновая музыка) запускается сам,
 * как только звук разрешён. Браузеры не дают включить звук без жеста
 * пользователя, поэтому первая попытка может провалиться — тогда ждём
 * первый клик по странице и пробуем снова.
 */

const STORAGE_KEY = 'ie-sound';
const DEFAULT_VOLUME = 0.4;

/** Состояние по умолчанию — тишина: незапрошенный звук раздражает. */
function defaultState() {
  return { muted: true, volume: DEFAULT_VOLUME };
}

function clampVolume(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, value));
}

function readState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return {
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : true,
      volume: clampVolume(parsed.volume),
    };
  } catch (error) {
    return defaultState();
  }
}

function writeState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    // Приватный режим или переполненное хранилище — просто не сохраняем.
  }
}

/** Фоновое видео немое по замыслу, звук ему включать нельзя. */
function isDecorativeVideo(element) {
  return element.tagName === 'VIDEO' && element.autoplay && element.hasAttribute('muted');
}

function isManaged(element) {
  if (!(element instanceof HTMLMediaElement)) return false;
  if (element.dataset.ieSound === 'ignore') return false;
  return !isDecorativeVideo(element);
}

class SoundController extends EventTarget {
  #state = readState();
  #started = false;
  #scheduled = false;

  get muted() {
    return this.#state.muted;
  }

  get volume() {
    return this.#state.volume;
  }

  start() {
    if (this.#started) return;
    this.#started = true;

    this.apply();

    // Медиа приезжает и после загрузки: секции через Section Rendering API,
    // корзина-ящик, быстрый просмотр. Следим за деревом, но перебор медиа
    // копим до кадра: правок DOM на странице много, а дорожек — единицы.
    new MutationObserver(() => this.#schedule()).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    // play всплывает не всегда — слушаем на фазе перехвата.
    document.addEventListener('play', (event) => this.#applyTo(event.target), true);

    if (!this.#state.muted) this.resume();
  }

  #schedule() {
    if (this.#scheduled) return;
    this.#scheduled = true;
    requestAnimationFrame(() => {
      this.#scheduled = false;
      this.apply();
    });
  }

  #media() {
    return Array.from(document.querySelectorAll('audio, video')).filter(isManaged);
  }

  #applyTo(element) {
    if (!isManaged(element)) return;
    element.muted = this.#state.muted;
    element.volume = this.#state.volume;
  }

  apply() {
    this.#media().forEach((element) => this.#applyTo(element));
  }

  /**
   * Запускает фоновые дорожки. Без пользовательского жеста браузер может
   * отказать — тогда вешаем одноразовый слушатель на первый клик.
   */
  resume() {
    const tracks = this.#media().filter(
      (element) => element.dataset.ieSoundAutoplay === 'true' && element.paused
    );
    if (tracks.length === 0) return;

    tracks.forEach((element) => {
      const attempt = element.play();
      if (attempt && typeof attempt.catch === 'function') {
        attempt.catch(() => this.#retryOnGesture());
      }
    });
  }

  #retryOnGesture() {
    if (this.gestureBound) return;
    this.gestureBound = true;

    const once = () => {
      this.gestureBound = false;
      if (!this.#state.muted) this.resume();
    };

    document.addEventListener('pointerdown', once, { once: true });
    document.addEventListener('keydown', once, { once: true });
  }

  update({ muted, volume } = {}) {
    if (typeof volume === 'number') {
      this.#state.volume = clampVolume(volume);
      // Ползунок в ноль — это и есть тишина.
      if (this.#state.volume === 0) this.#state.muted = true;
      else if (typeof muted !== 'boolean') this.#state.muted = false;
    }

    if (typeof muted === 'boolean') {
      this.#state.muted = muted;
      // Включать звук на нулевой громкости бессмысленно — возвращаем слышимую.
      if (!muted && this.#state.volume === 0) this.#state.volume = DEFAULT_VOLUME;
    }

    writeState(this.#state);
    this.apply();
    if (!this.#state.muted) this.resume();

    this.dispatchEvent(new CustomEvent('change', { detail: { ...this.#state } }));
  }

  toggle() {
    this.update({ muted: !this.#state.muted });
  }
}

const controller = new SoundController();
window.ieSound = controller;

class IeSoundControl extends HTMLElement {
  connectedCallback() {
    this.toggleButton = this.querySelector('[data-sound-toggle]');
    this.slider = this.querySelector('[data-sound-volume]');

    this.toggleButton?.addEventListener('click', () => controller.toggle());

    this.slider?.addEventListener('input', () => {
      controller.update({ volume: Number(this.slider.value) / 100 });
    });

    controller.addEventListener('change', () => this.render());

    this.render();
    controller.start();
  }

  render() {
    const muted = controller.muted;

    this.dataset.muted = String(muted);

    if (this.toggleButton) {
      this.toggleButton.setAttribute('aria-pressed', String(!muted));
      this.toggleButton.setAttribute(
        'aria-label',
        muted ? this.dataset.labelOn || 'Turn sound on' : this.dataset.labelOff || 'Turn sound off'
      );
    }

    if (this.slider && document.activeElement !== this.slider) {
      this.slider.value = String(Math.round(controller.volume * 100));
    }
  }
}

if (!customElements.get('ie-sound-control')) {
  customElements.define('ie-sound-control', IeSoundControl);
}
