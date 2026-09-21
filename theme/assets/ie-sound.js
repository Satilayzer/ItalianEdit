/*
 * Звук витрины Italian Edit.
 *
 * Одна кнопка в шапке глушит и включает весь звук на сайте, ползунок рядом
 * задаёт громкость. Состояние лежит в localStorage, поэтому переживает
 * переходы между страницами: включил звук на главной — он играет и дальше.
 *
 * Элемент с data-ie-sound-autoplay="true" (фоновая музыка) запускается сам,
 * как только звук разрешён. Браузеры не дают включить звук без жеста
 * пользователя, поэтому первая попытка может провалиться — тогда ждём
 * первый клик по странице и пробуем снова.
 *
 * Переход по ссылке на обычном сайте выгружает страницу вместе со звуком:
 * держать дорожку живой между загрузками нечем. Поэтому запоминаем, где
 * трек остановился, и на новой странице продолжаем с этого места, добавив
 * время, ушедшее на саму загрузку. Слышно это как непрерывную музыку.
 */

const STORAGE_KEY = 'ie-sound';
const POSITION_KEY = 'ie-sound-position';
const DEFAULT_VOLUME = 0.4;

/**
 * Сколько секунд запомненная позиция считается свежей.
 *
 * Полминуты с запасом покрывают переход между страницами, даже медленный.
 * Дольше — это уже не переход, а возвращение на сайт, и там честнее
 * начать трек сначала, чем с середины неизвестно чего.
 */
const POSITION_TTL = 30;

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

/**
 * Где остановилась фоновая дорожка: { time, at }.
 *
 * Отдельный ключ, а не поле в состоянии звука: пишется он часто, во время
 * игры раз в секунду, и мешать его с настройками покупателя незачем.
 */
function readPosition() {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (typeof parsed.time !== 'number' || typeof parsed.at !== 'number') return null;

    // Сколько прошло с момента записи: переход занимает время, и без этой
    // поправки музыка каждый раз повторяла бы уже отзвучавшую секунду.
    const elapsed = (Date.now() - parsed.at) / 1000;
    if (elapsed < 0 || elapsed > POSITION_TTL) return null;

    return parsed.time + elapsed;
  } catch (error) {
    return null;
  }
}

function writePosition(time) {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify({ time, at: Date.now() }));
  } catch (error) {
    // Не сохранили — трек просто начнётся сначала.
  }
}

/** Фоновое видео немое по замыслу, звук ему включать нельзя. */
function isDecorativeVideo(element) {
  return element.tagName === 'VIDEO' && element.autoplay && element.hasAttribute('muted');
}

/*
 * data-ie-sound можно повесить и на сам элемент, и на любого предка — секции
 * удобнее объявить режим один раз на обёртке:
 *   'ignore'  — не трогаем никогда;
 *   'managed' — отдаём общему переключателю, даже если это фоновое видео
 *               (герой стартует немым по правилам автозапуска, но звук
 *               появляется, когда покупатель его включает).
 */
function isManaged(element) {
  if (!(element instanceof HTMLMediaElement)) return false;

  const scope = element.closest('[data-ie-sound]');
  const mode = scope ? scope.dataset.ieSound : null;

  if (mode === 'ignore') return false;
  if (mode === 'managed') return true;

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

    // Последняя засечка перед уходом со страницы: между ней и timeupdate
    // успевает пройти до секунды, а слышно даже такой скачок.
    // pagehide, а не unload: в Safari на iOS unload не приходит вовсе.
    window.addEventListener('pagehide', () => {
      const playing = this.#tracks().find((element) => !element.paused);
      if (playing) writePosition(playing.currentTime);
    });

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
    const tracks = this.#tracks().filter((element) => element.paused);
    if (tracks.length === 0) return;

    tracks.forEach((element) => {
      this.#restorePosition(element);
      this.#trackPosition(element);

      const attempt = element.play();
      if (attempt && typeof attempt.catch === 'function') {
        attempt.catch(() => {
          // Запуск не состоялся — снимаем отметку, чтобы следующая попытка
          // отмотала дорожку заново, уже с учётом прошедшего времени.
          delete element.dataset.iePositionRestored;
          this.#retryOnGesture();
        });
      }
    });
  }

  /** Фоновые дорожки: те, что запускаются сами. */
  #tracks() {
    return this.#media().filter((element) => element.dataset.ieSoundAutoplay === 'true');
  }

  /**
   * Перематывает дорожку туда, где её застал уход с прошлой страницы.
   *
   * Остаток от длительности берём потому, что трек зациклен: за время
   * перехода он мог дойти до конца и пойти по второму кругу.
   *
   * Длительность известна не сразу — при preload="metadata" она приезжает
   * событием loadedmetadata, и тогда перематываем в нём.
   */
  #restorePosition(element) {
    if (element.dataset.iePositionRestored === 'true') return;

    const target = readPosition();
    if (target == null) return;

    element.dataset.iePositionRestored = 'true';

    const seek = () => {
      const { duration } = element;
      if (!Number.isFinite(duration) || duration <= 0) return;

      try {
        element.currentTime = target % duration;
      } catch (error) {
        // Перемотка до готовности дорожки — оставляем как есть.
      }
    };

    if (Number.isFinite(element.duration) && element.duration > 0) seek();
    else element.addEventListener('loadedmetadata', seek, { once: true });
  }

  /**
   * Пишет текущее место дорожки, чтобы следующая страница продолжила с него.
   *
   * Раз в секунду: timeupdate браузер шлёт чаще, а localStorage — синхронная
   * запись на диск, и частить ею на каждом кадре звука незачем.
   */
  #trackPosition(element) {
    if (element.dataset.iePositionBound === 'true') return;
    element.dataset.iePositionBound = 'true';

    let written = 0;

    element.addEventListener('timeupdate', () => {
      if (element.paused) return;

      const now = Date.now();
      if (now - written < 1000) return;

      written = now;
      writePosition(element.currentTime);
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
