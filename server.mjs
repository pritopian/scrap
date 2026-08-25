import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT || 8787);
const metaBaseUrl = process.env.META_BASE_URL || "https://api.meta.ai/v1";
const metaModel = process.env.META_VLM_MODEL || "muse-spark-1.1";
const jobs = new Map();
const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const jobsFile = path.join(projectRoot, ".scrap-jobs.json");

try {
  const savedJobs = JSON.parse(await readFile(jobsFile, "utf8"));
  savedJobs.forEach((job) => jobs.set(job.id, job));
} catch {
  // A fresh local install starts with no saved jobs.
}

async function persistJobs() {
  await writeFile(jobsFile, JSON.stringify([...jobs.values()], null, 2));
}

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*"
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) reject(new Error("Request is too large"));
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Request body must be valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

async function serveStatic(req, res) {
  const requestedPath = req.url === "/" ? "/index.html" : req.url;
  const filePath = path.resolve(projectRoot, `.${requestedPath}`);
  if (!filePath.startsWith(projectRoot + path.sep)) return false;
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8"
  };
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { "content-type": contentTypes[path.extname(filePath)] || "application/octet-stream" });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

function cleanText(value = "") {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20_000);
}

async function fetchSourceContext(sourceUrl) {
  try {
    const response = await fetch(sourceUrl, { redirect: "follow" });
    if (!response.ok) return { text: "", mediaUrls: [] };
    const html = await response.text();
    const imageUrl = (metaValue(html, "og:image") || metaValue(html, "twitter:image")).replace(/&amp;/g, "&");
    const title = metaValue(html, "og:title");
    const description = metaValue(html, "og:description");
    let mediaUrls = [];
    if (imageUrl) {
      try {
        const imageResponse = await fetch(imageUrl, { headers: { "user-agent": "Mozilla/5.0", accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" } });
        if (imageResponse.ok) {
          const mimeType = imageResponse.headers.get("content-type")?.split(";")[0] || "image/jpeg";
          const imageData = Buffer.from(await imageResponse.arrayBuffer()).toString("base64");
          mediaUrls = [`data:${mimeType};base64,${imageData}`];
        }
      } catch {
        // Muse receives text-only evidence when the social preview image is unavailable.
      }
    }
    return {
      text: [title, description, cleanText(html)].filter(Boolean).join("\n\n"),
      mediaUrls
    };
  } catch {
    return { text: "", mediaUrls: [] };
  }
}

async function analyzeWithVlm({ sourceUrl, caption, mediaUrls, pageText }) {
  if (!process.env.META) {
    return { products: [], reason: "META is not configured" };
  }

  const evidence = [
    `Source URL: ${sourceUrl}`,
    caption ? `Caption: ${caption}` : "",
    pageText ? `Shared page text: ${pageText}` : ""
  ].filter(Boolean).join("\n\n");
  const content = [
    {
      type: "input_text",
      text: `${evidence}\n\nInspect the supplied image evidence carefully. Identify a product only when its brand or product name is explicitly readable in the caption, on-screen text, audio transcript, packaging, or a clearly readable logo. If an item is only visually recognizable as a bag, shoe, dress, or accessory, do not identify an exact retail product. You may return it as visual_only for review, but visual_only items must never be sent to product search. A caption can mention a theme or comparison brand without being the brand of every item shown. Return only JSON matching the requested schema. Set evidence_type to explicit_text, visible_logo, or visual_only. Do not invent a precise model name.`
    },
    ...(mediaUrls || []).slice(0, 8).map((image_url) => ({ type: "input_image", image_url }))
  ];

  const response = await fetch(`${metaBaseUrl}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.META}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: metaModel,
      max_output_tokens: 4096,
      input: [{ role: "user", content }],
      text: {
        format: {
          type: "json_schema",
          name: "scrap_product_candidates",
          strict: true,
          schema: {
            type: "object",
            properties: {
              products: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    brand: { type: "string" },
                    product_name: { type: "string" },
                    evidence: { type: "string" },
                    evidence_type: { type: "string", enum: ["explicit_text", "visible_logo", "visual_only"] }
                  },
                  required: ["brand", "product_name", "evidence", "evidence_type"],
                  additionalProperties: false
                }
              }
            },
            required: ["products"],
            additionalProperties: false
          }
        }
      }
    })
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 800);
    throw new Error(`Meta request failed: ${response.status} ${detail}`);
  }
  const payload = await response.json();
  const outputText = payload.output_text || payload.output
    ?.flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text)
    .join("");
  return JSON.parse(outputText || '{"products":[]}');
}

async function searchOfficialProduct({ brand, productName, product_name }) {
  if (!process.env.EXA_API_KEY) return null;
  const resolvedProductName = productName || product_name;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "x-api-key": process.env.EXA_API_KEY,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        query: `${brand} ${resolvedProductName} official product page price`,
        type: "auto",
        numResults: 5,
        contents: { text: { maxCharacters: 4000 }, highlights: { maxCharacters: 1200 } }
      })
    });
    if (response.ok) {
      const payload = await response.json();
      const result = payload.results?.find((item) => item.url) || null;
      const image = typeof result.image === "string" ? result.image : result.image?.url || result.image?.src || "";
      return result ? { url: result.url, title: result.title || "", text: result.text || "", image, highlights: result.highlights || [] } : null;
    }
    if (response.status !== 429 || attempt === 2) throw new Error(`Exa request failed: ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
  }
  return null;
}

function extractFromSearchResult(result, candidate) {
  const price = result.text?.match(/(?:[$€£]\s?\d+(?:[.,]\d{2})?)/)?.[0] || "Price unavailable";
  return {
    name: result.title || candidate.productName,
    brand: candidate.brand,
    price,
    imageUrl: result.image || "",
    url: result.url
  };
}

function metaValue(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`, "i")
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

function extractProductPage(html, fallback) {
  const jsonLdBlocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of jsonLdBlocks) {
    try {
      const value = JSON.parse(block[1]);
      const entries = Array.isArray(value) ? value : [value, ...(value?.["@graph"] || [])];
      const product = entries.find((entry) => entry?.['@type'] === "Product" || entry?.['@type']?.includes?.("Product"));
      if (product) {
        const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
        return {
          name: product.name || fallback.productName,
          brand: typeof product.brand === "object" ? product.brand.name : product.brand || fallback.brand,
          price: offer?.price ? `${offer.priceCurrency || "$"}${offer.price}` : "Price unavailable",
          imageUrl: Array.isArray(product.image) ? product.image[0] : product.image || metaValue(html, "og:image"),
          url: fallback.url
        };
      }
    } catch {
      // Ignore malformed JSON-LD and fall back to Open Graph metadata.
    }
  }
  return {
    name: metaValue(html, "og:title") || fallback.productName,
    brand: fallback.brand,
    price: "Price unavailable",
    imageUrl: metaValue(html, "og:image"),
    url: fallback.url
  };
}

async function resolveProduct(candidate) {
  const normalized = { ...candidate, productName: candidate.productName || candidate.product_name };
  if (!["explicit_text", "visible_logo"].includes(candidate.evidence_type)) {
    return { ...normalized, status: "review", reason: "Visual item found, but no readable brand or product name was provided" };
  }
  if (!candidate.brand || /^unknown$/i.test(candidate.brand) || !candidate.productName || /^(unknown|unidentified|possible|black|white|red|cream|brown|visual)/i.test(candidate.productName)) {
    return { ...normalized, status: "review", reason: "Brand or product name was not grounded in readable evidence" };
  }
  let result;
  try {
    result = await searchOfficialProduct(normalized);
  } catch (error) {
    return { ...normalized, status: "review", reason: error.message };
  }
  if (!result) return { ...normalized, status: "review", reason: "No official product page found" };
  try {
    const response = await fetch(result.url, { headers: { "user-agent": "Scrap/0.1 (+product research)" } });
    if (!response.ok) {
      const product = extractFromSearchResult(result, normalized);
      return product.imageUrl && product.price !== "Price unavailable"
        ? { ...product, evidence: candidate.evidence, status: "ready", source: "Exa page extraction" }
        : { ...product, evidence: candidate.evidence, status: "review", reason: `Official page returned ${response.status}` };
    }
    const product = extractProductPage(await response.text(), { ...normalized, url: result.url });
    if (!product.imageUrl) return { ...product, evidence: candidate.evidence, status: "review", reason: "Product image was not available" };
    if (product.price === "Price unavailable") return { ...product, evidence: candidate.evidence, status: "review", reason: "Product price was not available" };
    return { ...product, evidence: candidate.evidence, status: "ready" };
  } catch {
    return { ...normalized, url: result.url, status: "review", reason: "Official page could not be read" };
  }
}

async function processJob(job, input) {
  try {
    job.status = "processing";
    job.step = "Understanding the Reel";
    const source = await fetchSourceContext(input.sourceUrl);
    const analysis = await analyzeWithVlm({
      ...input,
      pageText: source.text,
      mediaUrls: [...(input.mediaUrls || []), ...source.mediaUrls]
    });
    job.step = "Finding official product pages";
    job.products = [];
    for (const candidate of analysis.products) {
      job.products.push(await resolveProduct(candidate));
    }
    job.status = job.products.length === 0 || job.products.some((product) => product.status === "review") ? "review" : "ready";
    job.step = job.status === "ready" ? "Ready" : "Needs review";
    if (job.products.length === 0) job.reason = analysis.reason || "No product had explicit, verifiable brand or product evidence";
    await persistJobs();
  } catch (error) {
    job.status = "failed";
    job.step = "Could not finish";
    job.error = error.message;
    await persistJobs();
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" });
    return res.end();
  }
  if (req.method === "GET" && req.url === "/api/health") return json(res, 200, { ok: true, model: metaModel, provider: "meta" });
  if (req.method === "POST" && req.url === "/api/scraps") {
    try {
      const input = await readBody(req);
      if (!input.sourceUrl || !/^https?:\/\//i.test(input.sourceUrl)) return json(res, 400, { error: "A valid sourceUrl is required" });
      const job = { id: randomUUID(), sourceUrl: input.sourceUrl, status: "saved", step: "Saved", products: [], createdAt: new Date().toISOString() };
      jobs.set(job.id, job);
      await persistJobs();
      processJob(job, input);
      return json(res, 202, job);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }
  if (req.method === "GET" && req.url === "/api/scraps") return json(res, 200, [...jobs.values()]);
  const reviewMatch = req.url?.match(/^\/api\/scraps\/([^/]+)\/review$/);
  if (req.method === "POST" && reviewMatch) {
    try {
      const job = jobs.get(reviewMatch[1]);
      if (!job) return json(res, 404, { error: "Scrap not found" });
      const input = await readBody(req);
      const index = Number(input.productIndex);
      const product = job.products?.[index];
      if (!product) return json(res, 404, { error: "Product candidate not found" });
      if (input.action === "reject") job.products.splice(index, 1);
      if (input.action === "confirm") product.status = "ready";
      job.status = job.products.length && !job.products.some((item) => item.status === "review") ? "ready" : "review";
      job.step = job.status === "ready" ? "Ready" : "Needs review";
      await persistJobs();
      return json(res, 200, job);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }
  const match = req.url?.match(/^\/api\/scraps\/([^/]+)$/);
  if (req.method === "GET" && match) return jobs.has(match[1]) ? json(res, 200, jobs.get(match[1])) : json(res, 404, { error: "Scrap not found" });
  if (req.method === "GET" && await serveStatic(req, res)) return;
  return json(res, 404, { error: "Not found" });
});

server.listen(port, "127.0.0.1", () => console.log(`Scrap API listening on http://127.0.0.1:${port}`));
