# Wine Cellar · 多用户版设置指南

这个网站原本是把你一个人的酒柜写死在 `index.html` 里、改动只存在浏览器本地。
现在改造成了**多用户版**：任何人都能用邮箱+密码注册，各自建立并云端保存自己的酒柜，
还能加好友、把酒柜设成「好友可见」互相参观。

后端用的是 **Supabase**（免费额度足够个人使用），你不需要自己写或运维服务器，
网站仍然是纯静态页面，可以继续挂在 GitHub Pages / Vercel 等地方。

下面 10 分钟就能配好。

---

## 一、创建 Supabase 项目

1. 打开 <https://supabase.com> → 用 GitHub 或邮箱注册登录。
2. 点击 **New project**：
   - Name：随便填，比如 `wine-cellar`
   - Database Password：设一个强密码（这是数据库密码，自己留存，前端用不到）
   - Region：选离你近的（如 Singapore / Tokyo）
3. 等 1~2 分钟，项目初始化完成。

## 二、建表 + 配置权限

1. 左侧菜单 **SQL Editor** → **New query**。
2. 打开本仓库的 `supabase/schema.sql`，**全选复制**，粘贴进去。
3. 点 **Run**。看到成功（无红色报错）即可。
   - 这一步建好了 3 张表（用户资料 / 酒柜 / 好友关系），并打开了**行级安全**——
     从数据库层面保证「每个人只能读写自己的酒柜，好友只能看到你主动开放的酒柜」，
     前端怎么改都绕不过去。

## 三、拿到两把「钥匙」

1. 左侧菜单 **Project Settings**（齿轮）→ **API**。
2. 复制两样东西：
   - **Project URL**，形如 `https://abcdefgh.supabase.co`
   - **anon public** key（很长的一串）——注意是 **anon / public** 这一把，
     **不要**用 `service_role` 那把（那把是后台密钥，绝不能放进前端）。

> anon key 放在前端是**安全的**——真正保护数据的是上一步的行级安全策略，
> 不是靠把 key 藏起来。

## 四、把钥匙填进网站

打开 `index.html`，在文件靠上位置找到这一段（就在 `<script>` 主逻辑前面）：

```js
const SUPABASE_URL  = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';
```

把这两个值换成上一步复制的 **Project URL** 和 **anon public key**，保存。

## 五、（可选，但推荐先关）邮箱验证

Supabase 默认注册后要点邮箱里的验证链接才能登录。自己测试时可以先关掉，方便：

- **Authentication** → **Providers** → **Email** → 关闭 **Confirm email** → Save。

正式上线给别人用时，建议**重新打开**邮箱验证，防止乱注册。

## 六、跑起来 + 迁移你原来的数据

1. 直接双击打开 `index.html`（或部署后访问），会看到登录页。
2. 用你自己的邮箱+密码**注册**一个账号，登录进去——此时是个**空酒柜**。
3. 你原来那 85 瓶酒和评分/位置还在你这台电脑的浏览器本地。
   点页面底部 **Data & Backup** 区的按钮 **「从本机导入原有酒柜（一次性）」**，
   它会把你旧的酒柜数据一次性上传到你这个账号。以后在任何设备登录都能看到。

> 迁移只需在**你原来那台浏览器**上做一次。做完就可以删掉这个按钮或不再理它。

---

## 常见问题

- **登录页一直报错 / 转圈**：多半是第四步的 URL 或 key 填错，或第二步 SQL 没跑成功。
- **注册后登不进去**：邮箱验证没关（第五步），去邮箱点验证链接，或先按第五步关掉。
- **好友看不到我的酒柜**：需要两步——① 双方互加为好友（对方要在「好友」面板点同意）；
  ② 把酒柜可见性设为 **好友可见**（页面顶部的可见性下拉框）。
- **安全性**：不要把 `service_role` key 放进前端；`supabase/schema.sql` 里的 RLS 策略是数据安全的核心，不要删。

## 部署（可选）

网站仍是纯静态的，可以：
- **GitHub Pages**：仓库 Settings → Pages → 选分支即可。
- **Vercel / Netlify**：导入仓库，一键部署。

Supabase 里的 **Authentication → URL Configuration**，把你的正式域名加进
**Site URL / Redirect URLs**，邮箱验证链接才会跳回你的站点。

---

# 新功能说明（本轮新增）

## 1. 改酒柜名字
页面左上角的大标题就是当前酒柜的名字，**点它**（或顶部工具栏的 ✎）就能改。默认叫 "Wine Cellar"，每个用户/每个酒柜都能各自命名。

## 2. 一个账号多个酒柜，结构随意调
- 顶部「酒柜」下拉框切换酒柜；**＋** 新建、**✎** 改名、**🗑** 删除。
- 点 **🧰 结构** 进入结构编辑模式，可以：给某层 `＋行 / －行`、切换该层是否「站立摆放」、`删层`，底部 `＋添加一层`；每排容量用排尾的 `− / +` 调。
- 这样你可以建各种不同的酒柜：几瓶酒的「日常冰箱」（如一层一排）、几层的小酒架、或多层大酒窖。新酒柜默认是简单的 3 层。
- 调整结构时，如果某层/某排被删掉，里面的酒会自动回到「还没归位」，不会丢。

## 3. 新增酒时自动联网查资料（需部署一个函数）

新增酒的弹窗里有 **「🔎 联网查资料」** 按钮：填好酒名点一下，它会**联网搜索**这瓶酒的真实产区、国家、葡萄品种、混酿比例、RP/WS/Vivino 评分、参考价和一句话简介，自动填进表单。任何用户新增酒都能用。

它背后是一个 **Supabase Edge Function（`supabase/functions/wine-lookup`）**，用 Claude 的联网搜索能力查证信息，API 密钥只存在服务端。部署一次即可：

**准备：** 安装 Supabase CLI（`npm i -g supabase`，或见官网），并有一个 [Anthropic API key](https://console.anthropic.com/)。

```bash
# 在仓库根目录
supabase login
supabase link --project-ref <你的项目ref>        # ref 在 Supabase 项目 URL 里，如 abcdefgh

# 把 Anthropic 密钥存到服务端（不会进前端）
supabase secrets set ANTHROPIC_API_KEY=sk-ant-你的key

# 部署函数
supabase functions deploy wine-lookup
```

部署好后，前端的「🔎 联网查资料」就能用了（前端已经接好，不用再改代码）。

**成本提示：** 每次查询会调用一次带联网搜索的 Claude（默认用 `claude-opus-5`，最准）。想省钱可以把 `supabase/functions/wine-lookup/index.ts` 里的 `const MODEL = "claude-opus-5"` 改成 `"claude-sonnet-5"`（更便宜，同样支持联网搜索），改完重新 `supabase functions deploy wine-lookup`。

**没部署也不影响用**：不部署这个函数，新增酒时手动填字段照样能加，只是没有「自动填充」而已。

## 关于安全
- 联网查资料的 Anthropic 密钥用 `supabase secrets set` 存在服务端，**不在前端**，安全。
- 好友只读参观：编辑控件（新增/评分/拖拽/结构）在参观别人酒柜时会自动隐藏，且数据库 RLS 也不允许改别人的酒柜。
