import type { ShopifyClient } from "./client";

/**
 * Массовые операции Shopify (bulk operations).
 *
 * Тысячи товаров поштучными запросами — это часы и вечная борьба с лимитом
 * стоимости запросов. Bulk-операция принимает файл JSONL (строка = переменные
 * одной мутации), Shopify прогоняет его у себя асинхронно и отдаёт результат
 * тоже файлом. Чтение каталога — так же: один запрос, ответ файлом.
 */

interface UserError {
  field?: string[] | null;
  message: string;
}

export interface BulkOperation {
  id: string;
  status: string;
  errorCode: string | null;
  objectCount: string;
  url: string | null;
  partialDataUrl: string | null;
}

const STAGED_UPLOAD = /* GraphQL */ `
  mutation BulkStage($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }
`;

const RUN_MUTATION = /* GraphQL */ `
  mutation BulkRun($mutation: String!, $path: String!) {
    bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $path) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;

const RUN_QUERY = /* GraphQL */ `
  mutation BulkQuery($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;

const POLL = /* GraphQL */ `
  query BulkPoll($id: ID!) {
    node(id: $id) {
      ... on BulkOperation { id status errorCode objectCount url partialDataUrl }
    }
  }
`;

function throwOnErrors(op: string, errors: UserError[]): void {
  if (errors.length > 0) {
    throw new Error(`Shopify ${op}: ${errors.map((e) => e.message).join("; ")}`);
  }
}

/** Загружает JSONL во временное хранилище Shopify; возвращает путь для bulkOperationRunMutation. */
export async function stageJsonl(
  client: ShopifyClient,
  jsonl: string,
  fetchFn: typeof fetch = fetch
): Promise<string> {
  const data = await client.graphql<{
    stagedUploadsCreate: {
      stagedTargets: { url: string; resourceUrl: string; parameters: { name: string; value: string }[] }[];
      userErrors: UserError[];
    };
  }>(STAGED_UPLOAD, {
    input: [
      {
        resource: "BULK_MUTATION_VARIABLES",
        filename: "bulk.jsonl",
        mimeType: "text/jsonl",
        httpMethod: "POST",
      },
    ],
  });
  throwOnErrors("stagedUploadsCreate", data.stagedUploadsCreate.userErrors);
  const target = data.stagedUploadsCreate.stagedTargets[0];
  if (!target) throw new Error("Shopify stagedUploadsCreate: нет цели загрузки");

  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([jsonl], { type: "text/jsonl" }), "bulk.jsonl");
  const res = await fetchFn(target.url, { method: "POST", body: form, signal: AbortSignal.timeout(900_000) });
  if (!res.ok) throw new Error(`Загрузка JSONL: HTTP ${res.status} ${await res.text().catch(() => "")}`);

  const key = target.parameters.find((p) => p.name === "key")?.value;
  if (!key) throw new Error("Shopify stagedUploadsCreate: нет параметра key");
  return key;
}

export async function waitForBulk(
  client: ShopifyClient,
  id: string,
  opts: { intervalMs?: number; timeoutMs?: number; onProgress?: (op: BulkOperation) => void } = {}
): Promise<BulkOperation> {
  const started = Date.now();
  const interval = opts.intervalMs ?? 5_000;
  const timeout = opts.timeoutMs ?? 6 * 60 * 60_000;
  for (;;) {
    const data = await client.graphql<{ node: BulkOperation | null }>(POLL, { id });
    const op = data.node;
    if (!op) throw new Error(`Bulk-операция ${id} не найдена`);
    opts.onProgress?.(op);
    if (!["CREATED", "RUNNING", "CANCELING"].includes(op.status)) return op;
    if (Date.now() - started > timeout) throw new Error(`Bulk-операция ${id}: таймаут ожидания`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** Читает JSONL-результат bulk-операции. */
export async function readJsonl<T = Record<string, unknown>>(
  url: string | null,
  fetchFn: typeof fetch = fetch
): Promise<T[]> {
  if (!url) return [];
  const res = await fetchFn(url, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`Результат bulk-операции: HTTP ${res.status}`);
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

/** Строка JSONL на каждый набор переменных. */
export function toJsonl(variables: Record<string, unknown>[]): string {
  return variables.map((v) => JSON.stringify(v)).join("\n") + "\n";
}

/**
 * Запускает мутацию по каждому набору переменных и ждёт результата.
 * Возвращает строки результата (по одной на входную строку, с `__lineNumber`).
 */
export async function runBulkMutation<T = Record<string, unknown>>(
  client: ShopifyClient,
  mutation: string,
  variables: Record<string, unknown>[],
  opts: { onProgress?: (op: BulkOperation) => void; fetchFn?: typeof fetch } = {}
): Promise<{ operation: BulkOperation; results: T[] }> {
  const path = await stageJsonl(client, toJsonl(variables), opts.fetchFn);
  const started = await client.graphql<{
    bulkOperationRunMutation: { bulkOperation: { id: string } | null; userErrors: UserError[] };
  }>(RUN_MUTATION, { mutation, path });
  throwOnErrors("bulkOperationRunMutation", started.bulkOperationRunMutation.userErrors);
  const id = started.bulkOperationRunMutation.bulkOperation?.id;
  if (!id) throw new Error("bulkOperationRunMutation: нет id операции");

  const operation = await waitForBulk(client, id, { onProgress: opts.onProgress });
  const results = await readJsonl<T>(operation.url ?? operation.partialDataUrl, opts.fetchFn);
  if (operation.status !== "COMPLETED") {
    throw Object.assign(new Error(`Bulk-мутация ${operation.status} (${operation.errorCode ?? "—"})`), {
      operation,
      results,
    });
  }
  return { operation, results };
}

/** Bulk-запрос: весь результат одним JSONL (вложенные узлы — с `__parentId`). */
export async function runBulkQuery<T = Record<string, unknown>>(
  client: ShopifyClient,
  query: string,
  opts: { onProgress?: (op: BulkOperation) => void; fetchFn?: typeof fetch } = {}
): Promise<T[]> {
  const started = await client.graphql<{
    bulkOperationRunQuery: { bulkOperation: { id: string } | null; userErrors: UserError[] };
  }>(RUN_QUERY, { query });
  throwOnErrors("bulkOperationRunQuery", started.bulkOperationRunQuery.userErrors);
  const id = started.bulkOperationRunQuery.bulkOperation?.id;
  if (!id) throw new Error("bulkOperationRunQuery: нет id операции");
  const operation = await waitForBulk(client, id, { onProgress: opts.onProgress });
  if (operation.status !== "COMPLETED") {
    throw new Error(`Bulk-запрос ${operation.status} (${operation.errorCode ?? "—"})`);
  }
  return readJsonl<T>(operation.url, opts.fetchFn);
}
