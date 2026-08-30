/**
 * Смена размера/цвета прямо в корзине.
 *
 * Shopify не умеет менять вариант у строки корзины: `change.js` знает только
 * количество и свойства. Поэтому меняем в два запроса — сначала добавляем
 * новый вариант, потом убираем старую строку. Порядок именно такой: если
 * добавление не пройдёт (размер разобрали, пока корзина висела открытой),
 * корзина останется как была, а не опустеет.
 *
 * Добавление ещё и правильно склеивает строки: если выбранный размер уже
 * лежит в корзине, `add.js` увеличит его количество, а не заведёт вторую
 * строку. Через `update.js` одним запросом так не выходит — там количество
 * задаётся абсолютным числом, и одна из двух строк потерялась бы.
 *
 * Перерисовку не делаем сами: разослав CartLinesUpdateEvent, отдаём её теме.
 * `cart-items-component` подхватит секции из ответа и перерисует и шторку,
 * и страницу корзины, шапка обновит счётчик. Событие шлём с самого input —
 * компонент игнорирует только те события, которые пришли от него самого.
 */

import { fetchConfig } from '@theme/utilities';
import { CartLinesUpdateEvent } from '@shopify/events';

const OPTION_SELECTOR = '[data-ie-cart-option]';

/** @type {boolean} Пока запрос в полёте, второй клик игнорируем. */
let busy = false;

/**
 * @param {string} url
 * @param {object} body
 * @returns {Promise<any>}
 */
async function post(url, body) {
  const response = await fetch(url, fetchConfig('json', { body: JSON.stringify(body) }));
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  // Ошибку корзины Shopify отдаёт и с 4xx, и с полем description в теле.
  if (!response.ok || data.status || data.errors) {
    throw new Error(data.description || data.message || data.errors || 'Cart request failed');
  }

  return data;
}

/** @param {HTMLElement | null} row @param {string} message */
function showError(row, message) {
  const container = row?.querySelector('.cart-items__error');
  const text = row?.querySelector('.cart-item__error-text');
  if (!container || !text) return;
  text.textContent = message;
  container.classList.remove('hidden');
}

/** Возвращает отметку на то значение, с которым строка пришла с сервера. */
function revert(/** @type {HTMLInputElement} */ input) {
  const group = input.closest('[data-ie-cart-option-group]');
  const current = group instanceof HTMLElement ? group.dataset.ieCurrentValue : null;
  if (!group || current == null) return;

  for (const radio of group.querySelectorAll(OPTION_SELECTOR)) {
    if (radio instanceof HTMLInputElement) radio.checked = radio.value === current;
  }
}

document.addEventListener('change', async (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.matches(OPTION_SELECTOR)) return;

  const variantId = Number(input.dataset.variantId);
  const lineKey = input.dataset.lineKey;
  const quantity = Number(input.dataset.quantity) || 1;
  if (!variantId || !lineKey) return;

  if (busy) {
    revert(input);
    return;
  }
  busy = true;

  const row = input.closest('tr');
  const component = input.closest('cart-items-component');
  component?.classList.add('cart-items-disabled');

  const sections = [...document.querySelectorAll('cart-items-component')]
    .map((element) => (element instanceof HTMLElement ? element.dataset.sectionId : null))
    .filter((id) => Boolean(id));

  const deferred = CartLinesUpdateEvent.createPromise();
  input.dispatchEvent(
    new CartLinesUpdateEvent({
      action: 'update',
      context: 'cart',
      lines: [{ id: lineKey, quantity }],
      promise: deferred.promise,
    })
  );

  try {
    await post(Theme.routes.cart_add_url ?? '/cart/add.js', {
      items: [{ id: variantId, quantity }],
    });

    const cart = await post(Theme.routes.cart_change_url ?? '/cart/change.js', {
      id: lineKey,
      quantity: 0,
      sections: sections.join(','),
      sections_url: window.location.pathname,
    });

    deferred.resolve({
      cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
      detail: {
        sections: cart.sections,
        items: cart.items,
        itemCount: cart.item_count,
        source: 'ie-cart-variant',
        didError: false,
      },
    });
  } catch (error) {
    deferred.reject(error instanceof Error ? error : new Error(String(error)));
    revert(input);
    showError(row, error instanceof Error ? error.message : String(error));
  } finally {
    busy = false;
    component?.classList.remove('cart-items-disabled');
  }
});
