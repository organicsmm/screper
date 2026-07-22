const express = require("express");
const cors    = require("cors");
const https   = require("https");
const fs      = require("fs");
const path    = require("path");
const { execFile } = require("child_process");

const app = express();
app.use(cors());
app.use(express.json());
app.set("json spaces", 2);

// ── Config ────────────────────────────────────────────────────────────────────
const TG_TOKEN    = process.env.TG_TOKEN    || "8902989867:AAEyv3nZnqrWGadqrtBZ8IzkjiJ7MjPguJM";
const TG_CHAT_ID  = process.env.TG_CHAT_ID  || "8766641148";
const GH_TOKEN    = process.env.GH_TOKEN;
const GH_REPO     = "organicsmm/screper";
const VCL_TOKEN   = process.env.VCL_TOKEN;
const VCL_PROJECT   = "prj_1APovB4RWSIHemd0v73xCOdlz7an";
const VCL_TEAM      = "team_DHrze7VZ3tqOXzRXyoi0H5HG";
const IG_USER_AGENT = "Instagram 155.0.0.37.107 (iPhone11,8; iOS 14_4; en_US; en-US; scale=2.00; 828x1792; 190542906)";
const FALLBACK_API  = "https://instaprofile-production.up.railway.app/api/profile";

// ── Load cookies (from bundled cookies.json, updated at each deploy) ──────────
let SESSION_COOKIES = [];
try {
  const p = path.join(__dirname, "..", "cookies.json");
  SESSION_COOKIES = JSON.parse(fs.readFileSync(p, "utf8"));
} catch {
  SESSION_COOKIES = [
    "sessionid=44649264153%3AECjH4bpBwnhLbZ%3A25%3AAYhue6Vz3eymdQ2aiTnzBQOIULrH1g9rH_z-JO_A1A",
    "sessionid=76670837707%3A531WL8IMR66MaY%3A0%3AAYjUTyX5bpHZwA_nOkRzW09SacrLjfNH_RkuM6s55g",
    "sessionid=2294426582%3A1Owju4IkLRbV4n%3A13%3AAYgHkLx6VLFMUKgorb7oAQNauiV1l6aWwOYOIRLEVg",
  ];
}

// ── Generic HTTPS request helper ──────────────────────────────────────────────
function httpReq(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const bodyStr = body ? (typeof body === "string" ? body : JSON.stringify(body)) : null;
    const headers = { ...(options.headers || {}) };
    if (bodyStr) {
      headers["Content-Length"] = Buffer.byteLength(bodyStr);
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    }
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: options.method || "GET",
      headers,
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Instagram fetch ───────────────────────────────────────────────────────────
function igFetchWithCookie(url, cookie) {
  return new Promise((resolve, reject) => {
    const args = ["-s",
      "-H", `User-Agent: ${IG_USER_AGENT}`,
      "-H", "Accept-Language: en-US",
      "-H", "X-IG-App-ID: 936619743392459",
      "-H", `Cookie: ${cookie}`,
      url,
    ];
    execFile("curl", args, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`curl failed: ${stderr || err.message}`));
      const body = stdout.trim();
      if (!body) return reject(new Error("Empty response"));
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error(`Invalid JSON: ${body.slice(0, 200)}`)); }
    });
  });
}

async function igFetch(url) {
  let lastErr;
  for (const cookie of SESSION_COOKIES) {
    try {
      const data = await igFetchWithCookie(url, cookie);
      const msg = data?.message || "";
      if (msg === "challenge_required" || msg === "login_required") {
        lastErr = new Error(msg); continue;
      }
      return data;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("All cookies failed");
}

// ── Fallback API (used when all cookies are dead) ─────────────────────────────
async function fallbackFetch(username) {
  const data = await httpReq(`${FALLBACK_API}?username=${encodeURIComponent(username)}`);
  // Response is in data.response even if data.error exists
  const r = data?.response;
  if (!r || typeof r.followers === "undefined") throw new Error("Fallback: profile not found");
  return r;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function fetchUserId(username) {
  const data = await igFetch(
    `https://i.instagram.com/api/v1/users/${encodeURIComponent(username)}/usernameinfo/`
  );
  const id = data?.user?.id || data?.user?.pk;
  if (id) return id;
  throw new Error("Invalid username or API error");
}

function mediaTypeLabel(t) {
  return t === 1 ? "photo" : t === 2 ? "video" : t === 8 ? "carousel" : "unknown";
}

// ── Telegram helpers ──────────────────────────────────────────────────────────
async function tgSend(chatId, text, extra = {}) {
  return httpReq(
    `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,
    { method: "POST", headers: { "Content-Type": "application/json" } },
    { chat_id: chatId, text, parse_mode: "HTML", ...extra }
  );
}

// ── GitHub helpers ────────────────────────────────────────────────────────────
async function ghGetFile(filepath) {
  const res = await httpReq(
    `https://api.github.com/repos/${GH_REPO}/contents/${filepath}`,
    { headers: { Authorization: `Bearer ${GH_TOKEN}`, "User-Agent": "ig-bot", Accept: "application/vnd.github+json" } }
  );
  if (!res.content) throw new Error("File not found: " + filepath);
  return { content: Buffer.from(res.content, "base64").toString("utf8"), sha: res.sha };
}

async function ghUpdateFile(filepath, content, sha, message) {
  return httpReq(
    `https://api.github.com/repos/${GH_REPO}/contents/${filepath}`,
    { method: "PUT", headers: { Authorization: `Bearer ${GH_TOKEN}`, "User-Agent": "ig-bot", "Content-Type": "application/json", Accept: "application/vnd.github+json" } },
    { message, content: Buffer.from(content).toString("base64"), sha }
  );
}

// ── Vercel redeploy ───────────────────────────────────────────────────────────
async function vercelDeploy(cookiesJson) {
  const [indexFile, pkgFile, vclFile] = await Promise.all([
    ghGetFile("api/index.js"),
    ghGetFile("package.json"),
    ghGetFile("vercel.json"),
  ]);
  const res = await httpReq(
    `https://api.vercel.com/v13/deployments?teamId=${VCL_TEAM}`,
    { method: "POST", headers: { Authorization: `Bearer ${VCL_TOKEN}`, "Content-Type": "application/json" } },
    {
      name: "w-ig",
      project: VCL_PROJECT,
      target: "production",
      files: [
        { file: "api/index.js",  data: indexFile.content },
        { file: "package.json",  data: pkgFile.content },
        { file: "vercel.json",   data: vclFile.content },
        { file: "cookies.json",  data: cookiesJson },
      ],
    }
  );
  return res;
}

// ── Cookie test helper ────────────────────────────────────────────────────────
async function testCookie(cookie) {
  try {
    const data = await igFetchWithCookie(
      "https://i.instagram.com/api/v1/users/cristiano/usernameinfo/",
      cookie
    );
    const msg = data?.message || "";
    if (msg === "challenge_required") return "⚠️ challenge_required";
    if (msg === "login_required")     return "❌ login_required (expired)";
    if (data?.user?.username)         return "✅ Working";
    return "❓ Unknown: " + msg;
  } catch (e) {
    return "❌ Error: " + e.message;
  }
}

// ── Telegram Bot command handler ──────────────────────────────────────────────
async function handleTgUpdate(update) {
  const msg   = update.message || update.edited_message;
  if (!msg) return;
  const chatId = String(msg.chat.id);
  const text   = (msg.text || "").trim();
  const [cmd, ...args] = text.split(/\s+/);

  // Security: only respond to authorized chat
  if (chatId !== TG_CHAT_ID) {
    return tgSend(chatId, "❌ Unauthorized.");
  }

  // /start
  if (cmd === "/start") {
    return tgSend(chatId,
      `🤖 <b>Instagram Scraper Bot</b>\n\n` +
      `📋 <b>Commands:</b>\n` +
      `/status — Sab cookies ka status check karo\n` +
      `/cookies — Sab cookies list karo\n` +
      `/add &lt;sessionid&gt; — Naya cookie add karo\n` +
      `/replace &lt;n&gt; &lt;sessionid&gt; — Cookie replace karo\n` +
      `/remove &lt;n&gt; — Cookie hatao\n` +
      `/test &lt;username&gt; — Username test karo\n` +
      `/deploy — Manual redeploy karo`
    );
  }

  // /status — test each cookie
  if (cmd === "/status") {
    await tgSend(chatId, "⏳ Sab cookies test ho rahi hain...");
    const lines = await Promise.all(
      SESSION_COOKIES.map(async (c, i) => {
        const shortId = c.replace("sessionid=", "").split("%3A")[0];
        const result  = await testCookie(c);
        return `${i + 1}. <code>${shortId}</code>...\n   ${result}`;
      })
    );
    return tgSend(chatId, `🔍 <b>Cookie Status:</b>\n\n${lines.join("\n\n")}`);
  }

  // /cookies — list all
  if (cmd === "/cookies") {
    if (!SESSION_COOKIES.length) return tgSend(chatId, "⚠️ Koi cookie nahi hai!");
    const lines = SESSION_COOKIES.map((c, i) => {
      const val = c.replace("sessionid=", "");
      const short = val.slice(0, 20) + "..." + val.slice(-10);
      return `${i + 1}. <code>${short}</code>`;
    });
    return tgSend(chatId, `🍪 <b>Current Cookies (${SESSION_COOKIES.length}):</b>\n\n${lines.join("\n")}`);
  }

  // /add <sessionid>
  if (cmd === "/add") {
    const rawCookie = args[0];
    if (!rawCookie) return tgSend(chatId, "❌ Usage: /add &lt;sessionid_value&gt;");
    const cookie = rawCookie.startsWith("sessionid=") ? rawCookie : `sessionid=${rawCookie}`;
    await tgSend(chatId, "⏳ Cookie test ho rahi hai...");
    const status = await testCookie(cookie);
    if (!status.startsWith("✅")) return tgSend(chatId, `❌ Cookie kaam nahi kar rahi: ${status}`);
    const newList = [...SESSION_COOKIES, cookie];
    await tgSend(chatId, "⏳ GitHub update + Vercel deploy ho raha hai...");
    try {
      const cookiesJson = JSON.stringify(newList, null, 2);
      const { sha } = await ghGetFile("cookies.json");
      await ghUpdateFile("cookies.json", cookiesJson, sha, "Add new cookie via TG bot");
      await vercelDeploy(cookiesJson);
      return tgSend(chatId, `✅ Cookie add ho gayi!\n📦 Cookies: ${newList.length}\n🚀 Vercel deploy ho raha hai (~30s)`);
    } catch (e) {
      return tgSend(chatId, `❌ Deploy failed: ${e.message}`);
    }
  }

  // /replace <n> <sessionid>
  if (cmd === "/replace") {
    const idx = parseInt(args[0]) - 1;
    const rawCookie = args[1];
    if (isNaN(idx) || !rawCookie) return tgSend(chatId, "❌ Usage: /replace &lt;number&gt; &lt;sessionid_value&gt;");
    if (idx < 0 || idx >= SESSION_COOKIES.length) return tgSend(chatId, `❌ Invalid number. Total cookies: ${SESSION_COOKIES.length}`);
    const cookie = rawCookie.startsWith("sessionid=") ? rawCookie : `sessionid=${rawCookie}`;
    await tgSend(chatId, "⏳ Cookie test ho rahi hai...");
    const status = await testCookie(cookie);
    if (!status.startsWith("✅")) return tgSend(chatId, `❌ Cookie kaam nahi kar rahi: ${status}`);
    const newList = [...SESSION_COOKIES];
    newList[idx] = cookie;
    await tgSend(chatId, "⏳ GitHub update + Vercel deploy ho raha hai...");
    try {
      const cookiesJson = JSON.stringify(newList, null, 2);
      const { sha } = await ghGetFile("cookies.json");
      await ghUpdateFile("cookies.json", cookiesJson, sha, `Replace cookie #${idx + 1} via TG bot`);
      await vercelDeploy(cookiesJson);
      return tgSend(chatId, `✅ Cookie #${idx + 1} replace ho gayi!\n🚀 Vercel deploy ho raha hai (~30s)`);
    } catch (e) {
      return tgSend(chatId, `❌ Deploy failed: ${e.message}`);
    }
  }

  // /remove <n>
  if (cmd === "/remove") {
    const idx = parseInt(args[0]) - 1;
    if (isNaN(idx)) return tgSend(chatId, "❌ Usage: /remove &lt;number&gt;");
    if (idx < 0 || idx >= SESSION_COOKIES.length) return tgSend(chatId, `❌ Invalid number. Total cookies: ${SESSION_COOKIES.length}`);
    if (SESSION_COOKIES.length === 1) return tgSend(chatId, "❌ Kam se kam 1 cookie zaroori hai!");
    const newList = SESSION_COOKIES.filter((_, i) => i !== idx);
    await tgSend(chatId, "⏳ GitHub update + Vercel deploy ho raha hai...");
    try {
      const cookiesJson = JSON.stringify(newList, null, 2);
      const { sha } = await ghGetFile("cookies.json");
      await ghUpdateFile("cookies.json", cookiesJson, sha, `Remove cookie #${idx + 1} via TG bot`);
      await vercelDeploy(cookiesJson);
      return tgSend(chatId, `✅ Cookie #${idx + 1} remove ho gayi!\n📦 Remaining: ${newList.length}\n🚀 Vercel deploy ho raha hai (~30s)`);
    } catch (e) {
      return tgSend(chatId, `❌ Deploy failed: ${e.message}`);
    }
  }

  // /test <username>
  if (cmd === "/test") {
    const username = args[0];
    if (!username) return tgSend(chatId, "❌ Usage: /test &lt;username&gt;");
    await tgSend(chatId, `⏳ @${username} test ho raha hai...`);

    // Try primary (cookies)
    try {
      const data = await igFetch(
        `https://i.instagram.com/api/v1/users/${encodeURIComponent(username)}/usernameinfo/`
      );
      const u = data?.user;
      if (!u) return tgSend(chatId, "❌ User not found");
      return tgSend(chatId,
        `✅ <b>@${u.username}</b> <i>(primary)</i>\n` +
        `👥 Followers: <b>${(u.follower_count || 0).toLocaleString()}</b>\n` +
        `📸 Posts: ${u.media_count || 0}\n` +
        `🔒 Private: ${u.is_private ? "Yes" : "No"}\n` +
        `✔️ Verified: ${u.is_verified ? "Yes" : "No"}`
      );
    } catch (_) {}

    // Fallback
    try {
      const r = await fallbackFetch(username);
      return tgSend(chatId,
        `✅ <b>@${username}</b> <i>(fallback - cookies dead)</i>\n` +
        `👥 Followers: <b>${(r.followers || 0).toLocaleString()}</b>\n` +
        `📸 Posts: ${r.post_count || 0}\n` +
        `🔒 Private: ${r.is_private ? "Yes" : "No"}\n` +
        `✔️ Verified: ${r.is_verified ? "Yes" : "No"}\n` +
        `⚠️ Cookies expired hain — naya /add karo`
      );
    } catch (e) {
      return tgSend(chatId, `❌ Dono fail: ${e.message}`);
    }
  }

  // /deploy
  if (cmd === "/deploy") {
    await tgSend(chatId, "⏳ Manual deploy ho raha hai...");
    try {
      const { content: cookiesJson } = await ghGetFile("cookies.json");
      await vercelDeploy(cookiesJson);
      return tgSend(chatId, "✅ Deploy start ho gaya! ~30 seconds mein live hoga.");
    } catch (e) {
      return tgSend(chatId, `❌ Deploy failed: ${e.message}`);
    }
  }

  // Unknown command
  return tgSend(chatId, "❓ Pehchana nahi. /start se commands dekho.");
}

// ── Telegram Webhook endpoint ─────────────────────────────────────────────────
app.post("/telegram", async (req, res) => {
  try { await handleTgUpdate(req.body); } catch (e) { console.error("TG error:", e.message); }
  res.sendStatus(200); // Respond after processing
});

// ── Setup webhook (call once) ─────────────────────────────────────────────────
app.get("/setup-webhook", async (req, res) => {
  const host = req.headers.host || "w-ig-rose.vercel.app";
  const webhookUrl = `https://${host}/telegram`;
  const result = await httpReq(
    `https://api.telegram.org/bot${TG_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`,
    {}
  );
  res.json({ webhook: webhookUrl, result });
});

// ── GET /info?username= ───────────────────────────────────────────────────────
app.get("/info", async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: "Username parameter is required" });

  // Try primary (cookies)
  try {
    const data = await igFetch(
      `https://i.instagram.com/api/v1/users/${encodeURIComponent(username)}/usernameinfo/`
    );
    const user = data?.user;
    if (!user) return res.status(404).json({ error: "User not found" });
    const bioLinks = (user.bio_links ?? []).map((l) => l.url).filter(Boolean);
    return res.json({
      id: user.id || user.pk,
      username: user.username,
      full_name: user.full_name,
      bio: user.biography || null,
      category: user.category || null,
      website: user.external_url || null,
      bio_links: bioLinks,
      followers: user.follower_count ?? 0,
      following: user.following_count ?? 0,
      posts: user.media_count ?? 0,
      profile_picture: user.profile_pic_url,
      is_private: user.is_private,
      is_verified: user.is_verified,
      is_business: user.is_business,
      profile_url: `https://www.instagram.com/${username}/`,
      source: "primary",
    });
  } catch (_) {}

  // Fallback API
  try {
    const r = await fallbackFetch(username);
    return res.json({
      id: null,
      username: username,
      full_name: r.full_name || null,
      bio: r.biography || null,
      category: r.category || null,
      website: null,
      bio_links: [],
      followers: r.followers ?? 0,
      following: r.following ?? 0,
      posts: r.post_count ?? 0,
      profile_picture: r.profile_pic || null,
      is_private: r.is_private ?? false,
      is_verified: r.is_verified ?? false,
      is_business: false,
      profile_url: `https://www.instagram.com/${username}/`,
      source: "fallback",
    });
  } catch (e) {
    return res.status(500).json({ error: "All sources failed", details: e.message });
  }
});

// ── GET /posts?username= ──────────────────────────────────────────────────────
app.get("/posts", async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: "Username parameter is required" });

  // Try primary (cookies)
  try {
    const userId  = await fetchUserId(username);
    const MAX_POSTS = 25;
    const allItems  = [];
    let nextMaxId   = null;
    do {
      const remaining = MAX_POSTS - allItems.length;
      const url = `https://i.instagram.com/api/v1/feed/user/${userId}/?count=${remaining}${nextMaxId ? `&max_id=${nextMaxId}` : ""}`;
      const page = await igFetch(url);
      allItems.push(...(page.items ?? []));
      nextMaxId = page.more_available && page.next_max_id && allItems.length < MAX_POSTS ? page.next_max_id : null;
    } while (nextMaxId);

    const posts = allItems.map((post) => ({
      id: post.pk,
      shortcode: post.code,
      url: `https://www.instagram.com/p/${post.code}/`,
      type: mediaTypeLabel(post.media_type),
      caption: post.caption?.text ?? "",
      taken_at: post.taken_at,
      posted_at: new Date(post.taken_at * 1000).toISOString(),
      likes: post.like_count,
      comments: post.comment_count,
      plays: post.play_count ?? post.ig_play_count ?? null,
      duration_seconds: post.video_duration ? Math.round(post.video_duration * 10) / 10 : null,
      has_audio: post.has_audio ?? null,
      width: post.original_width,
      height: post.original_height,
      image_url: post.image_versions2?.candidates[0]?.url ?? null,
      video_url: post.video_versions?.[0]?.url ?? null,
      location: post.location ? { name: post.location.name, lat: post.location.lat, lng: post.location.lng } : null,
      accessibility_caption: post.accessibility_caption ?? null,
      carousel_items: post.carousel_media
        ? post.carousel_media.map((m) => ({
            type: mediaTypeLabel(m.media_type),
            image_url: m.image_versions2?.candidates[0]?.url ?? null,
            video_url: m.video_versions?.[0]?.url ?? null,
          }))
        : null,
    }));
    return res.json({ total: posts.length, posts, source: "primary" });
  } catch (_) {}

  // Fallback API — returns limited post data
  try {
    const r = await fallbackFetch(username);
    const posts = (r.posts ?? []).map((p, i) => ({
      id: `fallback_${username}_${i}`,
      shortcode: `fallback_${i}`,
      url: `https://www.instagram.com/${username}/`,
      type: p.is_video ? "video" : "photo",
      caption: "",
      taken_at: null,
      posted_at: null,
      likes: p.likes ?? 0,
      comments: p.comments ?? 0,
      plays: null,
      duration_seconds: null,
      has_audio: null,
      width: null,
      height: null,
      image_url: p.thumbnail ? `https://w-ig-rose.vercel.app/image-proxy?url=${encodeURIComponent(p.thumbnail)}` : null,
      video_url: null,
      location: null,
      accessibility_caption: null,
      carousel_items: null,
    }));
    return res.json({ total: posts.length, posts, source: "fallback" });
  } catch (e) {
    return res.status(500).json({ error: "All sources failed", details: e.message });
  }
});

// ── GET /reels?username= ──────────────────────────────────────────────────────
app.get("/reels", async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: "Username parameter is required" });

  // Try primary (cookies)
  try {
    const userId = await fetchUserId(username);
    const data   = await igFetch(`https://i.instagram.com/api/v1/clips/user/${userId}/`);
    if (!data.items?.length) return res.status(404).json({ error: "No reels found" });
    const reels = data.items.map(({ media: r }) => ({
      id: r.pk,
      shortcode: r.code,
      url: `https://www.instagram.com/reel/${r.code}/`,
      caption: r.caption?.text ?? "",
      taken_at: r.taken_at,
      posted_at: new Date(r.taken_at * 1000).toISOString(),
      likes: r.like_count,
      comments: r.comment_count,
      plays: r.play_count ?? r.ig_play_count ?? null,
      duration_seconds: r.video_duration ? Math.round(r.video_duration * 10) / 10 : null,
      has_audio: r.has_audio ?? null,
      width: r.original_width,
      height: r.original_height,
      image_url: r.image_versions2?.candidates[0]?.url ?? null,
      video_url: r.video_versions?.[0]?.url ?? null,
      source: "primary",
    }));
    return res.json({ total: reels.length, reels, source: "primary" });
  } catch (_) {}

  // Fallback — use is_video posts from fallback API
  try {
    const r = await fallbackFetch(username);
    const videos = (r.posts ?? []).filter(p => p.is_video);
    if (!videos.length) return res.status(404).json({ error: "No reels found", source: "fallback" });
    const reels = videos.map((p, i) => ({
      id: `fallback_reel_${username}_${i}`,
      shortcode: `fallback_reel_${i}`,
      url: `https://www.instagram.com/${username}/`,
      caption: "",
      taken_at: null,
      posted_at: null,
      likes: p.likes ?? 0,
      comments: p.comments ?? 0,
      plays: null,
      duration_seconds: null,
      has_audio: null,
      width: null,
      height: null,
      image_url: p.thumbnail ? `https://w-ig-rose.vercel.app/image-proxy?url=${encodeURIComponent(p.thumbnail)}` : null,
      video_url: null,
    }));
    return res.json({ total: reels.length, reels, source: "fallback" });
  } catch (e) {
    return res.status(500).json({ error: "All sources failed", details: e.message });
  }
});

// ── GET /image-proxy?url= ─────────────────────────────────────────────────────
app.get("/image-proxy", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "url param required" });
  try {
    const args = ["-s", "-L",
      "-H", "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X)",
      "-H", "Referer: https://www.instagram.com/",
      "--max-time", "10",
      url,
    ];
    execFile("curl", args, { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) return res.status(500).json({ error: "Fetch failed" });
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.send(stdout);
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /health ───────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", cookies: SESSION_COOKIES.length, timestamp: new Date().toISOString() });
});

module.exports = app;
