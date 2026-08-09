// Supabase Edge Function: wine-lookup  (DeepSeek 版)
// 任何用户新增一瓶酒时，前端调用这个函数，用 DeepSeek 补全酒的资料，返回结构化 JSON。
// DeepSeek API key 只存在服务端（见 SETUP.md）。
//
// 部署：supabase functions deploy wine-lookup
// 配置密钥：supabase secrets set DEEPSEEK_API_KEY=sk-...
//
// 注意：DeepSeek 的 API 没有实时联网搜索，返回的是模型自身知识里的资料，
// 对知名酒较准，对冷门/极新的酒或"实时价格"可能不知道（会返回 null）。

const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY");
const MODEL = "deepseek-chat"; // 也可用 "deepseek-reasoner"（更强、更慢、更贵）
const ENDPOINT = "https://api.deepseek.com/chat/completions"; // OpenAI 兼容

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

function parseWine(text: string) {
  if (!text) return null;
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s >= 0 && e > s) t = t.slice(s, e + 1);
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!DEEPSEEK_API_KEY) return json({ error: "server not configured: DEEPSEEK_API_KEY missing" }, 500);

  let name = "", vintage: number | string | null = null;
  try {
    const body = await req.json();
    name = (body?.name || "").toString().trim();
    vintage = body?.vintage ?? null;
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  if (!name) return json({ error: "missing name" }, 400);

  const sys = `你是一位严谨的葡萄酒资料员。根据你掌握的知识，给出这瓶酒的资料，并**只输出一个 JSON 对象**（不要任何解释文字）。不确定的字段填 null，不要编造具体分数或价格。

JSON 字段说明：
- winery: 规范化后的酒名(string)
- vintage: 年份数字或 null
- grape: 主要葡萄品种，用英文标准名，例如 Cabernet Sauvignon / Merlot / Pinot Noir / Chardonnay / Syrah / Sauvignon Blanc；混酿取占比最高的那个；无法判断填 "Other"
- grapeRaw: 混酿比例原文，例如 "85% Cabernet Sauvignon, 15% Merlot"；单一品种可填 "100% xxx"；未知填 null
- region: 产区(string)或 null
- country: 国家英文名，例如 France / USA / Italy / Australia / China / Chile / New Zealand，或 null
- rp: Robert Parker 评分(0-100 数字)或 null
- ws: Wine Spectator 评分(0-100 数字)或 null
- price: 参考市场价(美元数字)或 null
- vivino: Vivino 评分(0-5 数字)或 null
- desc: 一句话中文简介(20-40字)或 null`;

  const user = `酒名：${name}${vintage ? `，年份：${vintage}` : ""}。请给出上述 JSON。`;

  let resp: Response;
  try {
    resp = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 800,
      }),
    });
  } catch (e) {
    return json({ error: "network error calling DeepSeek: " + String(e) }, 502);
  }

  const data = await resp.json();
  if (!resp.ok) {
    return json({ error: data?.error?.message || "deepseek error", status: resp.status }, 502);
  }

  const content = data?.choices?.[0]?.message?.content || "";
  const wine = parseWine(content);
  if (!wine) return json({ error: "could not parse model output", raw: content }, 200);
  return json({ wine }, 200);
});
