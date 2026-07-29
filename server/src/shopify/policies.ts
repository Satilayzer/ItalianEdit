/**
 * Тексты правовых страниц магазина (Shopify shop policies).
 *
 * Живут в репозитории, а не только в админке, потому что это обещания
 * покупателю: их правят осознанно, а история правок должна быть видна.
 * Публикует их scripts/setup-policies.ts.
 *
 * Privacy Policy здесь НЕТ намеренно: в магазине стоит официальный шаблон
 * Shopify с подстановками и блоками под GDPR/CCPA. Он полнее и поддерживается
 * самим Shopify — заменять его самописным текстом было бы шагом назад.
 *
 * ВАЖНО. Всё, что ниже, — коммерческие обязательства (сроки, кто платит
 * за возврат, пошлины). Юрист их не проверял. Магазин — юрлицо США, но товар
 * едет со складов ЕС, а покупатели есть и в ЕС, поэтому право на отказ
 * от покупки по правилам ЕС вынесено отдельным разделом.
 */

/** Коммерческие условия. Меняются здесь — во всех текстах подставятся сами. */
export const TERMS = {
  /** Рабочих дней от оплаты до передачи в доставку. */
  processingDays: "1–3 business days",
  /** Сроки доставки после отправки. */
  deliveryEu: "3–7 business days",
  deliveryUs: "5–10 business days",
  deliveryRest: "10–20 business days",
  /** Срок на возврат с момента получения. Для ЕС ниже 14 дней опускать нельзя. */
  returnWindowDays: 14,
  /** Сколько идут деньги обратно после приёмки возврата. */
  refundDays: "5–10 business days",
  /** Кто платит обратную пересылку при отказе без причины. */
  returnShippingPaidBy: "the customer",
} as const;

export const CONTACT = {
  legalName: "Italian Edit",
  email: "hello@italian-edit.com",
  phone: "+1 727 463 1656",
  address: "712 S Howard Ave, Tampa, FL 33606, United States",
  hours: "Monday to Friday, 9:00–18:00 (EST)",
} as const;

const contactBlock = `
  <h2>Contact</h2>
  <p>
    ${CONTACT.legalName}<br>
    Email: <a href="mailto:${CONTACT.email}">${CONTACT.email}</a><br>
    Phone: ${CONTACT.phone}<br>
    ${CONTACT.address}
  </p>`;

// ── Shipping ────────────────────────────────────────────────────────────────

export const SHIPPING_POLICY = `
  <h2>Order Processing</h2>
  <p>Orders are prepared for dispatch within ${TERMS.processingDays} of payment being
  confirmed. Orders placed on weekends or public holidays are processed on the next
  business day. You will receive a confirmation email as soon as your order is on its way.</p>

  <h2>Where Your Order Ships From</h2>
  <p>Our pieces are dispatched from partner warehouses in the European Union and the
  United States, and a small selection is sent directly from Italy. The dispatch location
  depends on the item, not on your delivery address, so an order containing several pieces
  may arrive in more than one parcel and on different days. You are never charged extra
  for a split delivery.</p>

  <h2>Delivery Times and Costs</h2>
  <p>Shipping costs are calculated at checkout before payment. Delivery times below are
  estimates counted from dispatch, not from the moment the order is placed, and exclude
  weekends and public holidays.</p>
  <ul>
    <li>European Union: ${TERMS.deliveryEu}</li>
    <li>United States: ${TERMS.deliveryUs}</li>
    <li>Rest of the world: ${TERMS.deliveryRest}</li>
  </ul>

  <h2>Customs, Duties and Import Taxes</h2>
  <p>Because orders may cross a border on their way to you, customs duties, import taxes
  or handling fees can be charged by the authorities in your country. These charges are
  set by your local authorities, are not included in the price you pay us, and are the
  responsibility of the recipient. We cannot predict their amount in advance. If a parcel
  is refused at customs and returned to us, the outbound shipping cost is not refundable.</p>

  <h2>Tracking Your Order</h2>
  <p>A tracking number is sent by email once your parcel leaves the warehouse. Carriers
  usually need 24–48 hours before tracking shows any movement, so please allow that time
  before getting in touch.</p>

  <h2>Delayed or Lost Parcels</h2>
  <p>Once a parcel is handed to the carrier, its progress is outside our control. Customs
  inspections, weather and carrier backlogs can add time. If tracking has not updated for
  seven business days, contact us and we will open an investigation with the carrier. We
  cannot issue a refund or replacement while a carrier investigation is still open.</p>

  <h2>Incorrect Delivery Addresses</h2>
  <p>Please check your address carefully before paying — it is copied to the carrier
  exactly as entered. If you spot a mistake, contact us within 12 hours of ordering and we
  will correct it if the parcel has not yet been dispatched. Parcels lost because of an
  incorrect or incomplete address cannot be refunded.</p>

  <h2>Damaged Parcels</h2>
  <p>If your parcel arrives damaged, photograph the outer packaging and the item before
  removing any tags, and send the photographs to us within 48 hours of delivery. We will
  arrange a replacement or a full refund at no cost to you.</p>
  ${contactBlock}`;

// ── Refunds ─────────────────────────────────────────────────────────────────

export const REFUND_POLICY = `
  <h2>Returns</h2>
  <p>You may return an item within ${TERMS.returnWindowDays} days of receiving it. To be
  accepted, the item must be unworn and unused, in its original condition, with all tags,
  authenticity cards, dust bags and original packaging included. Items showing signs of
  wear, alteration, perfume or damage cannot be accepted.</p>

  <h2>How to Start a Return</h2>
  <p>Contact us at <a href="mailto:${CONTACT.email}">${CONTACT.email}</a> with your order
  number before sending anything back. We will confirm the return address for that
  particular item — our pieces ship from several warehouses, so returns are not all sent
  to the same place, and a parcel returned to the wrong address may be lost. Returns sent
  without prior confirmation cannot be processed.</p>

  <h2>Return Shipping</h2>
  <p>Return shipping is paid by ${TERMS.returnShippingPaidBy} when an item is returned
  because you changed your mind. We recommend a tracked service: until the parcel reaches
  the warehouse it remains your responsibility. If the item is faulty, damaged or not what
  you ordered, we cover the return shipping in full.</p>

  <h2>Items That Cannot Be Returned</h2>
  <ul>
    <li>Gift cards</li>
    <li>Pierced jewellery and earrings, for hygiene reasons</li>
    <li>Items marked final sale at the time of purchase</li>
    <li>Items returned without tags, packaging or authenticity cards</li>
  </ul>
  <p>This does not affect your rights if an item is faulty, damaged or incorrectly
  described.</p>

  <h2>Refunds</h2>
  <p>Once your return arrives and passes inspection, we issue the refund to your original
  payment method within ${TERMS.refundDays}. How quickly it appears on your statement
  depends on your bank. Original shipping costs are refunded only where the return is due
  to our error or a faulty item. Customs duties already paid to your local authorities are
  refunded by those authorities, not by us — keep your receipts and contact them directly.</p>

  <h2>Exchanges</h2>
  <p>We do not process direct exchanges. If you need a different size or colour, return the
  original item for a refund and place a new order — this is faster and secures the piece
  before it sells out.</p>

  <h2>Damaged, Faulty or Incorrect Items</h2>
  <p>Inspect your order on arrival. If an item is faulty, damaged or not the one you
  ordered, contact us within 48 hours with photographs and we will arrange a replacement
  or a full refund, including all shipping costs, at no charge to you.</p>

  <h2>Late or Missing Refunds</h2>
  <p>If your refund has not appeared after ${TERMS.refundDays}, first check with your bank
  or card issuer, as processing on their side can take longer than ours. If it is still
  missing, contact us with your order number and we will trace it.</p>

  <h2>Right of Withdrawal (European Union and United Kingdom)</h2>
  <p>If you are a consumer in the EU or the UK, you have a statutory right to withdraw from
  your purchase within 14 days of receiving it, without giving a reason. To exercise it,
  send us a clear statement at <a href="mailto:${CONTACT.email}">${CONTACT.email}</a>
  before that period expires. We will refund all payments received from you, including
  standard outbound delivery, within 14 days of being notified, though we may wait until
  the goods are returned to us. You are responsible for the cost of returning the goods and
  for any loss in their value caused by handling beyond what is necessary to establish
  their nature and characteristics. Nothing in this policy limits these statutory rights.</p>
  ${contactBlock}`;

// ── Terms of Service ────────────────────────────────────────────────────────

export const TERMS_OF_SERVICE = `
  <h2>Overview</h2>
  <p>This website is operated by ${CONTACT.legalName}. By visiting our site or placing an
  order you agree to the terms set out below. Please read them carefully. If you do not
  agree with them, please do not use the site.</p>

  <h2>Eligibility</h2>
  <p>You must be at least the age of majority in your place of residence to purchase from
  us. You agree to provide accurate and complete information when placing an order, and to
  keep your account details, if you create an account, confidential.</p>

  <h2>Products, Pricing and Availability</h2>
  <p>We make every effort to display our products and their colours accurately, but we
  cannot guarantee that your screen reproduces colour faithfully. Product descriptions and
  measurements are supplied by the brand or by our distribution partners and may contain
  errors or omissions. Prices are shown in ${"USD"} and may change without notice.</p>
  <p>All items are subject to availability. Because stock is shared with our distribution
  partners, an item may sell out between your order being placed and being picked. If that
  happens we will contact you and refund the item in full. We reserve the right to limit
  quantities or to refuse any order.</p>

  <h2>Orders and Payment</h2>
  <p>Your order is an offer to buy. A contract is formed only when we confirm dispatch.
  Payment is taken at checkout through Shopify's payment providers; we do not store your
  card details. If we suspect fraud or an unauthorised transaction we may cancel the order
  and refund it.</p>

  <h2>Authenticity</h2>
  <p>Every item we sell is guaranteed authentic and sourced through authorised distribution
  channels. We are not an authorised retailer of, and are not affiliated with, the brands
  we carry; brand names and trademarks belong to their respective owners and are used only
  to describe the goods offered.</p>

  <h2>Shipping and Returns</h2>
  <p>Delivery and returns are governed by our Shipping Policy and Refund Policy, which form
  part of these terms.</p>

  <h2>Intellectual Property</h2>
  <p>The layout, text and original photography on this site belong to us or to our
  licensors and may not be copied or reused without written permission. Brand imagery and
  product photography remain the property of the respective brands.</p>

  <h2>Acceptable Use</h2>
  <p>You may not use this site for any unlawful purpose, to infringe anyone's rights, to
  transmit malicious code, to collect data about other users, or to interfere with the
  operation or security of the site.</p>

  <h2>Disclaimer and Limitation of Liability</h2>
  <p>The site and its content are provided as they are, without warranties of any kind,
  except those that cannot be excluded by law. To the fullest extent permitted by law, our
  total liability arising out of any order is limited to the amount you paid for that
  order. Nothing here excludes liability for death or personal injury caused by negligence,
  for fraud, or any other liability that cannot lawfully be excluded — including the
  statutory rights of consumers in the European Union and the United Kingdom.</p>

  <h2>Indemnity</h2>
  <p>You agree to indemnify us against any claim arising from your breach of these terms or
  your misuse of the site.</p>

  <h2>Governing Law</h2>
  <p>These terms are governed by the laws of the State of Florida, United States. Where you
  buy as a consumer resident elsewhere, this does not deprive you of the protection of the
  mandatory consumer laws of your country of residence.</p>

  <h2>Changes to These Terms</h2>
  <p>We may update these terms from time to time. The version published on this page at the
  moment you place an order is the version that applies to that order.</p>
  ${contactBlock}`;

// ── Contact information ─────────────────────────────────────────────────────

export const CONTACT_INFORMATION = `
  <p>We answer every message ourselves, usually within one business day. For questions
  about an existing order, please include your order number.</p>

  <h2>Get in Touch</h2>
  <p>
    Email: <a href="mailto:${CONTACT.email}">${CONTACT.email}</a><br>
    Phone: ${CONTACT.phone}<br>
    Hours: ${CONTACT.hours}
  </p>

  <h2>Business Address</h2>
  <p>
    ${CONTACT.legalName}<br>
    ${CONTACT.address}
  </p>
  <p>This is our registered business address and not a returns address or a shop open to
  the public. Our pieces are dispatched from partner warehouses in Europe and the United
  States, so please always request a return address before sending anything back —
  see our Refund Policy.</p>`;

/**
 * Снимает отступы, которые тексты набрали от шаблонных строк. На отрисовку они
 * не влияют, но текст ещё вставляют руками в админку и читают в диффе.
 */
function dedent(html: string): string {
  return html
    .split("\n")
    .map((line) => line.trimEnd().replace(/^\s+/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Что публикует scripts/setup-policies.ts. Privacy Policy сознательно не входит. */
export const POLICIES = [
  { type: "SHIPPING_POLICY", title: "Shipping Policy", body: dedent(SHIPPING_POLICY) },
  { type: "REFUND_POLICY", title: "Refund Policy", body: dedent(REFUND_POLICY) },
  { type: "TERMS_OF_SERVICE", title: "Terms of Service", body: dedent(TERMS_OF_SERVICE) },
  {
    type: "CONTACT_INFORMATION",
    title: "Contact Information",
    body: dedent(CONTACT_INFORMATION),
  },
] as const;
