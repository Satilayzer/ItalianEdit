/*
 * Быстрое добавление: шторка по кнопке «Choose» на карточке каталога.
 *
 * Что здесь есть, а чего нет:
 *   — начинку шторки рисует Liquid (sections/ie-quick-add.liquid), сюда
 *     она приезжает Section Rendering API по адресу товара;
 *   — саму шторку (открыть, закрыть, замок прокрутки, закрытие после
 *     добавления в корзину) держит тема: <quick-add-dialog> из
 *     snippets/quick-add-modal.liquid — это её DialogComponent;
 *   — добавление в корзину делает тоже тема: внутри начинки лежит
 *     <product-form-component>, он оживает при вставке в документ.
 *
 * Наша работа — принести разметку, переключать варианты и показать
 * таблицу размеров (её шторку берём у страницы товара, см. ниже).
 *
 * Штатный быстрый выбор Horizon (assets/quick-add.js) не годится: он
 * тянет со страницы товара узел [data-product-grid-content], которого
 * у нашей страницы товара нет, и шторка открывалась пустой.
 */

/* Ответ секции одинаков для одного адреса — второй раз не запрашиваем. */
const cache = new Map();

/** Пустая шторка на время запроса лучше, чем задержка перед открытием. */
const SPINNER = '<div class="ie-qa ie-qa--loading" aria-busy="true"></div>';

function slot() {
  return document.getElementById('quick-add-modal-content');
}

/**
 * Адрес начинки. Вариант подставляем тот, что уже выбран на карточке
 * (образцы цвета Horizon), иначе шторка откроется на первом.
 */
function contentUrl(button) {
  const base = button.dataset.productUrl;
  if (!base) return '';

  const url = new URL(base, window.location.origin);
  url.searchParams.set('section_id', 'ie-quick-add');

  const card = button.closest('product-card');
  const variantId = card && card.getSelectedVariantId ? card.getSelectedVariantId() : null;
  if (variantId) url.searchParams.set('variant', variantId);

  return url.toString();
}

async function fetchContent(url) {
  if (cache.has(url)) return cache.get(url);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Быстрое добавление: ответ ${response.status}`);

  const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
  const node = parsed.querySelector('[data-ie-qa]');
  if (!node) throw new Error('Быстрое добавление: в ответе нет начинки');

  const html = node.outerHTML;
  cache.set(url, html);
  return html;
}

async function open(button) {
  const target = slot();
  const dialog = document.getElementById('quick-add-dialog');
  if (!target || !dialog) return;

  target.innerHTML = SPINNER;

  // Элемент шторки может ещё не подняться — тема грузит модули отложенно.
  await customElements.whenDefined('quick-add-dialog');
  if (typeof dialog.showDialog === 'function') dialog.showDialog();

  const url = contentUrl(button);
  if (!url) return;

  // Метку ставим до запроса: по ней узнаём, что ответ уже неактуален.
  target.dataset.url = url;

  try {
    const html = await fetchContent(url);

    // Пока шёл запрос, шторку могли открыть на другом товаре.
    if (target.dataset.url !== url) return;
    target.innerHTML = html;

    sync(target.querySelector('[data-ie-qa]'));
  } catch (error) {
    console.warn(error);
    target.innerHTML = '';
    if (typeof dialog.closeDialog === 'function') dialog.closeDialog();
  }
}

/* ------------------------------------------------------------------ */
/* Переключение вариантов                                              */
/* ------------------------------------------------------------------ */

function variants(root) {
  const node = root.querySelector('[data-ie-qa-variants]');
  if (!node) return [];
  try {
    return JSON.parse(node.textContent);
  } catch {
    return [];
  }
}

function groups(root) {
  return Array.from(root.querySelectorAll('[data-ie-qa-option-group]'));
}

function chosen(root) {
  return groups(root).map((group) => {
    const input = group.querySelector('input[data-ie-qa-option]:checked');
    return input ? input.value : null;
  });
}

function matchVariant(root) {
  const values = chosen(root);
  return variants(root).find(
    (variant) => variant.options.length === values.length && variant.options.every((value, i) => value === values[i])
  );
}

function thumbs(root) {
  return Array.from(root.querySelectorAll('[data-ie-qa-thumb]'));
}

/** Выбранную миниатюру помечаем aria-current — оформление идёт по нему. */
function selectMedia(root, index) {
  const list = thumbs(root);
  const thumb = list[index];
  const main = root.querySelector('[data-ie-qa-main]');
  if (!thumb || !main) return;

  main.src = thumb.dataset.src;
  if (thumb.dataset.srcset) main.srcset = thumb.dataset.srcset;
  main.alt = thumb.dataset.alt || '';

  list.forEach((item, i) => {
    if (i === index) item.setAttribute('aria-current', 'true');
    else item.removeAttribute('aria-current');
  });
}

function setText(root, selector, value) {
  const node = root.querySelector(selector);
  if (node) node.textContent = value || '';
}

function setAvailability(root, available, text) {
  const button = root.querySelector('[data-ie-qa-add-to-cart] button');
  if (!button) return;

  button.disabled = !available;

  const label = button.querySelector('.add-to-cart-text__content span span');
  if (label && text) label.textContent = text;
}

/**
 * Гасим значения, которых нет в наличии при уже выбранных остальных
 * опциях. На странице товара такого пересчёта нет — там доступность
 * приходит с сервера один раз; здесь она обновляется на каждом клике,
 * иначе при двух опциях покупатель тыкал бы вслепую.
 */
function markAvailability(root) {
  const all = variants(root);
  const values = chosen(root);

  groups(root).forEach((group, index) => {
    group.querySelectorAll('input[data-ie-qa-option]').forEach((input) => {
      const probe = values.slice();
      probe[index] = input.value;

      const reachable = all.some(
        (variant) =>
          variant.available &&
          variant.options.every((value, i) => (probe[i] == null ? true : value === probe[i]))
      );

      const label = input.closest('.ie-qa__value');
      if (label) label.classList.toggle('ie-qa__value--out', !reachable);
    });
  });
}

/** Подпись «Size: 38.5» рядом с названием опции. */
function updateLabels(root) {
  groups(root).forEach((group) => {
    const label = group.querySelector('[data-ie-qa-option-value]');
    const input = group.querySelector('input[data-ie-qa-option]:checked');
    if (label && input) label.textContent = input.value;
  });
}

function sync(root) {
  if (!root) return;

  updateLabels(root);
  markAvailability(root);

  const variant = matchVariant(root);

  if (!variant) {
    setAvailability(root, false, root.dataset.textUnavailable);
    return;
  }

  const input = root.querySelector('input[name="id"]');
  if (input) input.value = variant.id;

  setText(root, '[data-ie-qa-price]', variant.price);
  setText(root, '[data-ie-qa-sku]', variant.sku);

  const compare = root.querySelector('[data-ie-qa-compare]');
  const discount = root.querySelector('[data-ie-qa-discount]');
  if (compare) {
    compare.textContent = variant.compare_at || '';
    compare.hidden = !variant.compare_at;
  }
  if (discount) {
    discount.textContent = variant.discount || '';
    discount.hidden = !variant.discount;
  }

  setAvailability(root, variant.available, variant.available ? root.dataset.textAdd : root.dataset.textSoldOut);

  if (variant.media_index != null) selectMedia(root, variant.media_index);
}

/* ------------------------------------------------------------------ */
/* Таблица размеров                                                    */
/* ------------------------------------------------------------------ */

/*
 * Таблицы живут в настройках секции товара (sections/ie-product.liquid),
 * поэтому шторку не повторяем, а берём готовую со страницы товара.
 * Страницу целиком, а не Section Rendering API: секция шаблона отзывается
 * только на полный id вида template--<число>__main, а число своё у каждой
 * копии темы — «main» отдаёт 404. Запрос идёт лишь по клику и кешируется.
 * Оформление шторки общее: snippets/ie-size-guide-styles.liquid.
 *
 * Шторку кладём в <body>, а не в начинку. Внутри окна быстрой покупки
 * любой клик по ней тема сочла бы кликом мимо окна (isClickedOutside
 * сравнивает координаты) и закрыла бы покупку. Открытая через showModal
 * позже, шторка ложится в верхнем слое поверх окна; Esc закрывает
 * верхний диалог — то есть её.
 */
/** Как в ie-product.js: французская и итальянская обувь — в колонке «IT/EU». */
const GUIDE_FALLBACK = { fr: ['eu', 'it'], it: ['eu'], eu: ['it'] };

/** Разметка шторки по адресу товара; null — у товара таблицы нет. */
const guideCache = new Map();

async function fetchGuide(productUrl) {
  if (guideCache.has(productUrl)) return guideCache.get(productUrl);

  const response = await fetch(productUrl);
  if (!response.ok) throw new Error(`Таблица размеров: ответ ${response.status}`);

  const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
  const node = parsed.querySelector('[data-ie-guide]');
  const html = node ? node.outerHTML : null;
  guideCache.set(productUrl, html);
  return html;
}

async function openGuide(button) {
  const root = button.closest('[data-ie-qa]');
  const productUrl = button.dataset.url;
  if (!root || !productUrl || button.getAttribute('aria-busy') === 'true') return;

  button.setAttribute('aria-busy', 'true');
  let html = null;
  try {
    html = await fetchGuide(productUrl);
  } catch (error) {
    console.warn(error);
  } finally {
    button.removeAttribute('aria-busy');
  }

  // Шторку не получили — таблица всё равно есть на странице товара.
  if (!html) {
    window.location.href = productUrl;
    return;
  }

  document.querySelector('[data-ie-qa-guide]')?.remove();

  const holder = document.createElement('div');
  holder.innerHTML = html;
  const guide = holder.firstElementChild;

  // Своя метка вместо data-ie-guide: на странице товара (рекомендации
  // с быстрой покупкой) родная шторка тоже в документе, и путать их нельзя.
  guide.removeAttribute('data-ie-guide');
  guide.setAttribute('data-ie-qa-guide', '');
  const title = guide.querySelector('[id]');
  if (title) {
    title.id = `${title.id}-qa`;
    guide.setAttribute('aria-labelledby', title.id);
  }

  document.body.append(guide);
  guide.addEventListener('close', () => guide.remove());

  markGuideRow(guide, root);
  guide.showModal();
}

/**
 * Подсветить строку выбранного размера — то же правило, что #markGuideRow
 * в ie-product.js: «42 IT» → колонка IT, «38 FR» → FR, потом EU и IT,
 * «M» → INT, голое число у джинсов → W.
 */
function markGuideRow(guide, root) {
  const table = guide.querySelector('[data-ie-guide-table]');
  if (!table || !table.tHead || !table.tBodies[0]) return;

  const group = root.querySelector('[data-ie-qa-size-group]');
  const input = group ? group.querySelector('input[data-ie-qa-option]:checked') : null;
  const value = input ? input.value : null;
  if (!value) return;

  const match = value.trim().match(/^(\d+(?:[.,]\d+)?)\s*([a-z]+)?$/i);
  let size;
  let systems;
  if (match) {
    size = match[1].replace(',', '.');
    const system = (match[2] || '').toLowerCase();
    systems = system ? [system, ...(GUIDE_FALLBACK[system] || [])] : ['w', 'it', 'eu'];
  } else {
    size = value.trim().toLowerCase();
    systems = ['int'];
  }

  const headers = Array.from(table.tHead.rows[0].cells).map((cell) =>
    cell.textContent.trim().toLowerCase().split(/[\s/]+/)
  );
  const column = systems.map((system) => headers.findIndex((tokens) => tokens.includes(system))).find((i) => i !== -1);
  if (column === undefined) return;

  const row = Array.from(table.tBodies[0].rows).find((tr) => {
    const cell = tr.cells[column];
    return cell && cell.textContent.trim().toLowerCase().replace(',', '.') === size;
  });
  if (row) row.setAttribute('data-current', '');
}

/* ------------------------------------------------------------------ */
/* Слушатели                                                           */
/* ------------------------------------------------------------------ */

/*
 * Делегирование на документе: кнопки приезжают вместе с карточками
 * (постраничная подгрузка каталога, фильтры), а начинка шторки — из
 * запроса. Вешать обработчики на каждый узел пришлось бы заново после
 * каждой перерисовки.
 */
document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;

  const button = event.target.closest('[data-ie-quick-add]');
  if (button) {
    // Кнопка лежит поверх ссылки-оверлея карточки, иначе уедем на товар.
    event.preventDefault();
    event.stopPropagation();
    open(button);
    return;
  }

  const guideButton = event.target.closest('[data-ie-qa-guide-open]');
  if (guideButton) {
    event.preventDefault();
    openGuide(guideButton);
    return;
  }

  // Крестик или клик по затемнению: у <dialog> затемнение — это сам диалог.
  const guide = event.target.closest('[data-ie-qa-guide]');
  if (guide) {
    if (event.target.closest('[data-ie-guide-close]') || event.target === guide) guide.close();
    return;
  }

  const thumb = event.target.closest('[data-ie-qa-thumb]');
  if (!thumb) return;

  const root = thumb.closest('[data-ie-qa]');
  if (root) selectMedia(root, thumbs(root).indexOf(thumb));
});

document.addEventListener('change', (event) => {
  if (!event.target.matches('[data-ie-qa-option]')) return;

  const root = event.target.closest('[data-ie-qa]');
  if (root) sync(root);
});

/*
 * Товар добавили — цены и остатки могли измениться, а кешированная
 * начинка об этом не знает. Чистим, как это делает штатный быстрый
 * выбор темы.
 */
document.addEventListener('shopify:cart:lines-update', () => cache.clear());
