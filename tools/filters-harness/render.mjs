import { Liquid, Tag } from 'liquidjs';
import fs from 'node:fs';

const C3 = process.env.THEME_DIR || 'D:/ItalianEdit/_work/c3';
fs.copyFileSync(C3 + '/assets/ie-filters.js', new URL('./assets/ie-filters.js', import.meta.url));
const engine = new Liquid({ root: ['stubs', C3 + '/snippets'], extname: '.liquid', jsTruthy: false });
let styles = [];

class DocTag extends Tag {
  constructor(token, remain, liquid) {
    super(token, remain, liquid);
    while (remain.length) {
      const t = remain.shift();
      if (t.name === 'enddoc') return;
    }
  }
  *render() {}
}
class StyleTag extends Tag {
  constructor(token, remain, liquid) {
    super(token, remain, liquid);
    this.raw = '';
    while (remain.length) {
      const t = remain.shift();
      if (t.name === 'endstylesheet') return;
      this.raw += t.getText();
    }
  }
  *render() {
    styles.push(this.raw);
  }
}
engine.registerTag('doc', DocTag);
engine.registerTag('stylesheet', StyleTag);

const T = {
  'actions.show_filters': 'Filters',
  'blocks.filter': 'Filters',
  'actions.close': 'Close',
  'actions.sort': 'Sort',
  'actions.clear': 'Clear',
  'actions.clear_all': 'Clear all',
};
engine.registerFilter('t', (k, ...args) => {
  if (k === 'content.item_count') {
    const n = args.find((a) => Array.isArray(a))?.[1] ?? 0;
    return n == 1 ? `${n} item` : `${n} items`;
  }
  return T[k] ?? k;
});
engine.registerFilter('asset_url', (f) => '/assets/' + f);
const money = (c) => '$' + (Number(c) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
engine.registerFilter('money_without_trailing_zeros', money);
engine.registerFilter('money_without_currency', (c) => (Number(c) / 100).toFixed(2));
engine.registerFilter('handleize', (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
);

const v = (param, label, count, active = false, value = label) => ({
  param_name: param,
  label,
  value,
  count,
  active,
  url_to_remove: '/collections/clothing?removed=' + encodeURIComponent(label),
});
function list(param, label, values) {
  return {
    type: 'list',
    param_name: param,
    label,
    values,
    active_values: values.filter((x) => x.active),
    url_to_remove: '/collections/clothing?clear=' + param,
  };
}
const designers = ['Gucci', 'Prada', 'Miu Miu', 'Saint Laurent', 'Bottega Veneta', 'Valentino', 'Balenciaga', 'Celine', 'Loewe', 'Fendi', 'Dior', 'Chanel', 'Givenchy', 'Versace', 'Dolce & Gabbana', 'Tom Ford', 'The Row', 'Loro Piana', 'Burberry', 'Jil Sander', 'Off-White', 'Golden Goose', 'Moncler', 'Max Mara', 'Alexander McQueen'];

function filters(active) {
  const A = (x) => Boolean(active && x);
  return [
    list('filter.v.availability', 'Availability', [
      v('filter.v.availability', 'In stock', 812, A(true), '1'),
      v('filter.v.availability', 'Out of stock', 259, false, '0'),
    ]),
    {
      type: 'price_range',
      param_name: 'filter.v.price',
      label: 'Price',
      range_max: 1250000,
      min_value: { param_name: 'filter.v.price.gte', value: active ? 50000 : null },
      max_value: { param_name: 'filter.v.price.lte', value: active ? 200000 : null },
      url_to_remove: '/collections/clothing?price',
      values: [],
      active_values: [],
    },
    list('filter.p.m.italian_edit.gender', 'Gender', [
      v('filter.p.m.italian_edit.gender', 'Men', 300),
      v('filter.p.m.italian_edit.gender', 'Kids', 40),
      v('filter.p.m.italian_edit.gender', 'Women', 731, A(true)),
    ]),
    list('filter.p.m.italian_edit.subcategory', 'Subcategory',
      ['Dresses', 'Tops', 'Jeans', 'Sweaters', 'Jackets', 'Pants', 'Skirts', 'Shirts'].map((n, i) =>
        v('filter.p.m.italian_edit.subcategory', n, 120 - i * 9))),
    list('filter.v.option.size', 'Size',
      ['XL', 'S', 'M', 'XS', 'L', '36', '37', '38', '39', '40', '41'].map((n, i) =>
        v('filter.v.option.size', n, i == 3 ? 0 : 50 + i))),
    list('filter.p.vendor', 'Designers', designers.map((n, i) => v('filter.p.vendor', n, 60 - i, A(n === 'Gucci')))),
    list('filter.p.m.italian_edit.sale', 'Sale', [
      v('filter.p.m.italian_edit.sale', '50%+ off', 30),
      v('filter.p.m.italian_edit.sale', 'Up to 30% off', 80),
      v('filter.p.m.italian_edit.sale', '30–50% off', 55),
    ]),
    list('filter.p.m.italian_edit.color', 'Color',
      ['Black', 'White', 'Beige', 'Brown', 'Red', 'Pink', 'Green', 'Blue', 'Gold', 'Multicolor'].map((n, i) =>
        v('filter.p.m.italian_edit.color', n, 90 - i * 7, A(n === 'Green')))),
  ];
}

const settings = {
  ie_custom: true,
  enable_filtering: true,
  enable_sorting: true,
  enable_grid_density: true,
  ie_inset: 16,
  ie_price_bands: '0-500, 500-1000, 1000-2000, 2000-5000, 5000+',
  ie_value_order: 'Women|Men|Kids|XXS|XS|S|M|L|XL|XXL|XXXL|Up to 30% off|30–50% off|50%+ off',
  ie_in_stock_label: 'In Stock',
  ie_apply_label: 'Apply',
};

for (const active of [false, true]) {
  styles = [];
  const html = await engine.renderFile('ie-filters', {
    results: { sort_options: [{ value: 'manual', name: 'Featured' }, { value: 'price-ascending', name: 'Price, low to high' }] },
    filters: filters(active),
    results_url: '/collections/clothing',
    sort_by: 'manual',
    products_count: active ? 37 : 1071,
    total_active_values: active ? 5 : 0,
    section_id: 'main',
    block_settings: settings,
    attributes: 'data-collection-id="1"',
  });
  const page = fs
    .readFileSync('page.html', 'utf8')
    .replace('<!--STYLES-->', '<style>' + [...new Set(styles)].join('\n') + '</style>')
    .replace('<!--BODY-->', html);
  fs.writeFileSync(active ? 'active.html' : 'index.html', page);
}
console.log('ok');
