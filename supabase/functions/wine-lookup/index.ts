// Supabase Edge Function: wine-lookup
// 任何用户新增一瓶酒时，前端调用这个函数，它用 Claude + 联网搜索查证真实资料，
// 返回结构化 JSON 用于填充酒卡。Anthropic API key 只存在服务端（见 SETUP.md）。
//
// 部署：supabase functions deploy wine-lookup
// 配置密钥：supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

// 用带联网搜索的模型。opus-5 最准；想省钱可改成 "claude-sonnet-5"（同样支持联网搜索）。
const MODEL = "claude-opus-5";

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
  if (!ANTHROPIC_API_KEY) return json({ error: "server not configured: ANTHROPIC_API_KEY missing" }, 500);

  let name = "", vintage: number | string | null = null;
  try {
    const body = await req.json();
    name = (body?.name || "").toString().trim();
    vintage = body?.vintage ?? null;
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  if (!name) return json({ error: "missing name" }, 400);

  const prompt = `你是一位严谨的葡萄酒资料员。请联网搜索查证下面这瓶酒的真实信息，然后**只输出一个 JSON 对象**（不要任何解释文字，不要 markdown 代码块）。

酒名：${name}${vintage ? `\n年份：${vintage}` : ""}

要求的 JSON 字段（查不到的字段填 null，不要编造具体分数/价格）：
{
 "winery": "规范化后的酒名(string)",
 "vintage": 年份数字或 null,
 "grape": "主要葡萄品种，用英文标准名，例如 Cabernet Sauvignon / Merlot / Pinot Noir / Chardonnay / Syrah；混酿取占比最高的那个；实在无法判断填 Other",
 "grapeRaw": "混酿比例原文，例如 85% Cabernet Sauvignon, 15% Merlot；单一品种可填 100% xxx；未知填 null",
 "region": "产区(string)或 null",
 "country": "国家英文名，例如 France / USA / Italy / Australia / China / Chile / New Zealand，或 null",
 "rp": Robert Parker 评分(0-100 数字)或 null,
 "ws": Wine Spectator 评分(0-100 数字)或 null,
 "price": 参考市场价(美元数字)或 null,
 "vivino": Vivino 评分(0-5 数字)或 null,
 "desc": "一句话中文简介(20-40字)或 null"
}`;

  let messages: any[] = [{ role: "user", content: prompt }];
  let data: any = null;

  for (let i = 0; i < 5; i++) {
    let resp: Response;
    try {
      resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1024,
          tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 4 }],
          messages,
        }),
      });
    } catch (e) {
      return json({ error: "network error calling Anthropic: " + String(e) }, 502);
    }
    data = await resp.json();
    if (!resp.ok) return json({ error: data?.error?.message || "anthropic error", status: resp.status }, 502);

    // 服务端搜索循环达到上限会 pause_turn —— 追加助手内容再请求一次即可继续
    if (data.stop_reason === "pause_turn") {
      messages = [...messages, { role: "assistant", content: data.content }];
      continue;
    }
    break;
  }

  const text = (data?.content || [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");

  const wine = parseWine(text);
  if (!wine) return json({ error: "could not parse model output", raw: text }, 200);
  return json({ wine }, 200);
});
