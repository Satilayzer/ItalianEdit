# Тема витрины — редизайн по макетам Figma

Здесь лежат **только наши файлы** темы Shopify, а не вся тема целиком.
База — Horizon (themeStoreId 3625), она живёт в Shopify; в репозиторий
копируется лишь то, что мы правим или добавляем.

- Рабочая тема: **Italian Edit — redesign (Figma)**, `gid://shopify/OnlineStoreTheme/158724227303`,
  статус UNPUBLISHED. Сделана как копия живой темы «Italian Edit — wishlist»,
  живая тема не тронута.
- Макеты: https://www.figma.com/design/VW8CX7OXDPx4TtOzITOYOl/Italian-Editor

## Что здесь

| Файл | Назначение |
|---|---|
| `assets/ie-design.css` | Токены дизайна, шапка, карточка товара, сетка каталога. Подключается из `snippets/stylesheets.liquid` последним, чтобы перекрывать Horizon. |
| `snippets/ie-product-card.liquid` | Карточка товара витрины: картинка 2:3, название капсом, цена, бренд. |
| `sections/ie-hero.liquid` | Герой главной во всю ширину. |
| `sections/ie-marquee.liquid` | Тёмная бегущая строка под героем. |
| `sections/ie-product-row.liquid` | Полоса товаров из коллекции + кнопка «Shop now». |
| `sections/ie-split-banner.liquid` | Сплит-баннер MEN / WOMEN. |
| `sections/ie-label-strip.liquid` | Полоса брендов (фирменные этикетки). |
| `sections/ie-instagram.liquid` | Мозаика Instagram. |
| `sections/ie-feedbacks.liquid` | Отзывы бумажными карточками. |
| `sections/ie-404.liquid` | Страница 404 с полноэкранным фото. |
| `sections/header-group.json` | Раскладка шапки: меню слева, логотип по центру, действия справа. |
| `templates/index.json` | Главная страница. |
| `templates/404.json` | 404. |

Файл `snippets/stylesheets.liquid` в теме дополнен одной строкой — подключением
`ie-design.css`. Локальной копии не держим, чтобы не расходиться с темой.

## Как залить изменения

Shopify CLI в проекте не настроен, у серверного приложения нет scope
`write_themes`. Файлы заливаются мутацией `themeFilesUpsert` Admin API
(через MCP-коннектор Shopify). Порядок важен: сначала секции, потом шаблоны —
шаблон не пройдёт валидацию, если секции ещё нет.

## Открытые места

- Картинок из макета нет: герой, панели MEN/WOMEN, этикетки брендов и кадры
  Instagram стоят с плейсхолдерами — их нужно загрузить в редакторе темы.
- Правый блок шапки — иконки темы, а в макете текст SEARCH / SIGN IN / CART.
- Каталог, карточка товара и страница дизайнеров ещё не переверстаны.
