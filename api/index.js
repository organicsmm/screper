const express = require("express");
const cors = require("cors");
const { execFile } = require("child_process");

const app = express();
app.use(cors());
app.use(express.json());
app.set("json spaces", 2);

// ── Config ───────────────────────────────────────────────────────────────────
const SESSION_COOKIES = [
  process.env.SESSION_COOKIE  || "sessionid=44649264153%3AECjH4bpBwnhLbZ%3A25%3AAYiGwnBGeY0unjtJo41vBRIykfHmzMKd_fQSTI8W6A",
  process.env.SESSION_COOKIE2 || "sessionid=76670837707%3A531WL8IMR66MaY%3A0%3AAYgyI6DLZ3MjD4QwE1krewS5-IudlgT8vpYdYgoEQA",
];

// Round-robin counter — rotates per request to spread load across accounts
let cookieIndex = 0;
function getNextCookie() {
  const cookie = SESSION_COOKIES[cookieIndex % SESSION_COOKIES.length];
  cookieIndex++;
  return cookie;
}

// Two proxies — primary p104, fallback p105
const PROXIES = [
  process.env.PROXY_URL  || "http://4776:YuBaZsVLtUQ2@p104.instantproxies.com:8910",
  process.env.PROXY_URL2 || "http://4776:YuBaZsVLtUQ2@p105.instantproxies.com:8909",
];

const IG_USER_AGENT =
  "Instagram 155.0.0.37.107 (iPhone11,8; iOS 14_4; en_US; en-US; scale=2.00; 828x1792; 190542906)";

// ── Core fetch (tries all cookie+proxy combos) ────────────────────────────────
function igFetchWith(url, cookieIndex, proxyIndex) {
  return new Promise((resolve, reject) => {
    const proxy = PROXIES[proxyIndex];
    const cookie = SESSION_COOKIES[cookieIndex];
    const args = ["-s", "--max-time", "20"];
    if (proxy) args.push("-x", proxy);
    args.push(
      "-H", `User-Agent: ${IG_USER_AGENT}`,
      "-H", "Accept-Language: en-US",
      "-H", "X-IG-App-ID: 936619743392459",
      "-H", `Cookie: ${cookie}`,
      url
    );
    execFile("curl", args, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`curl failed: ${stderr || err.message}`));
      const body = stdout.trim();
      if (!body) return reject(new Error("Empty response"));
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error(`Invalid JSON: ${body.slice(0, 200)}`));
      }
    });
  });
}

async function igFetch(url, _proxyIndex = 0) {
  // Try every cookie × proxy combo until one succeeds
  const combos = [];
  for (let c = 0; c < SESSION_COOKIES.length; c++)
    for (let p = 0; p < PROXIES.length; p++)
      combos.push([c, p]);

  // Start from round-robin cookie to spread load
  const start = cookieIndex % SESSION_COOKIES.length;
  cookieIndex++;
  combos.sort((a) => (a[0] === start ? -1 : 1));

  let lastErr;
  for (const [c, p] of combos) {
    try {
      const data = await igFetchWith(url, c, p);
      // challenge_required means this cookie is blocked — try next
      if (data?.message === "challenge_required") {
        lastErr = new Error("challenge_required");
        continue;
      }
      return data;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("All cookies/proxies failed");
}

function proxyImage(url) {
  return new Promise((resolve, reject) => {
    const args = ["-s", "--max-time", "15", "-x", PROXIES[0],
      "-H", "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X)",
      "-H", "Referer: https://www.instagram.com/",
      url
    ];
    execFile("curl", args, { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(new Error(`curl failed: ${err.message}`));
      resolve(stdout);
    });
  });
}

async function fetchUserId(username) {
  const data = await igFetch(
    `https://i.instagram.com/api/v1/users/${encodeURIComponent(username)}/usernameinfo/`
  );
  const id = data?.user?.id || data?.user?.pk;
  if (!id) throw new Error("User not found or private");
  return id;
}

const mediaTypeLabel = (t) =>
  t === 1 ? "photo" : t === 2 ? "video" : t === 8 ? "carousel" : "unknown";

// ── Routes ────────────────────────────────────────────────────────────────────

app.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Instagram Scraper API</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f5f7fa; margin: 0; padding: 2rem; color: #333; }
    h1 { color: #111; }
    code { background: #eee; padding: 2px 6px; border-radius: 4px; font-size: 14px; }
    footer { margin-top: 3rem; font-size: 14px; color: #555; }
  </style>
</head>
<body>
  <h1>📸 Instagram Scraper API</h1>
  <h2>Endpoints</h2>
  <ul>
    <li><code>GET /info?username=</code> — Profile info</li>
    <li><code>GET /posts?username=</code> — Last 80 posts</li>
    <li><code>GET /reels?username=</code> — Reels</li>
    <li><code>GET /stories?username=</code> — Stories</li>
    <li><code>GET /proxy?url=</code> — Image proxy</li>
  </ul>
  <footer>Educational use only.</footer>
</body>
</html>`);
});

// GET /proxy?url=
app.get("/proxy", async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) return res.status(400).json({ error: "Missing url parameter" });
  try {
    const data = await proxyImage(imageUrl);
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(data);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch image", details: e.message });
  }
});

// GET /info?username=
app.get("/info", async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: "Username required" });
  try {
    const data = await igFetch(
      `https://i.instagram.com/api/v1/users/${encodeURIComponent(username)}/usernameinfo/`
    );
    const user = data?.user;
    if (!user) return res.status(404).json({ error: "User not found" });

    const bioLinks = (user.bio_links ?? []).map((l) => l.url).filter(Boolean);

    res.json({
      id: user.id || user.pk,
      username: user.username,
      full_name: user.full_name,
      bio: user.biography || null,
      website: user.external_url || null,
      bio_links: bioLinks,
      followers: user.follower_count ?? 0,
      following: user.following_count ?? 0,
      posts: user.media_count ?? 0,
      profile_picture: user.profile_pic_url,
      is_private: user.is_private,
      is_verified: user.is_verified,
      is_business: user.is_business,
      category: user.category || null,
      profile_url: `https://www.instagram.com/${user.username}/`,
    });
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch data", details: e.message });
  }
});

// GET /posts?username=
app.get("/posts", async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: "Username required" });
  try {
    const userId = await fetchUserId(username);

    const MAX_POSTS = 80;
    const allItems = [];
    let nextMaxId = null;
    do {
      const remaining = MAX_POSTS - allItems.length;
      const url = `https://i.instagram.com/api/v1/feed/user/${userId}/?count=${remaining}${nextMaxId ? `&max_id=${nextMaxId}` : ""}`;
      const page = await igFetch(url);
      allItems.push(...(page.items ?? []));
      nextMaxId = page.more_available && page.next_max_id && allItems.length < MAX_POSTS
        ? page.next_max_id : null;
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
      duration_seconds: post.video_duration
        ? Math.round(post.video_duration * 10) / 10 : null,
      has_audio: post.has_audio ?? null,
      width: post.original_width,
      height: post.original_height,
      image_url: post.image_versions2?.candidates[0]?.url ?? null,
      video_url: post.video_versions?.[0]?.url ?? null,
      location: post.location
        ? { name: post.location.name, lat: post.location.lat, lng: post.location.lng }
        : null,
      carousel_items: post.carousel_media
        ? post.carousel_media.map((m) => ({
            type: mediaTypeLabel(m.media_type),
            image_url: m.image_versions2?.candidates[0]?.url ?? null,
            video_url: m.video_versions?.[0]?.url ?? null,
          }))
        : null,
    }));

    res.json({ total: posts.length, posts });
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch data", details: e.message });
  }
});

// GET /reels?username=
app.get("/reels", async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: "Username required" });
  try {
    const userId = await fetchUserId(username);
    const data = await igFetch(
      `https://i.instagram.com/api/v1/clips/user/${userId}/`
    );
    if (!data.items?.length) return res.status(404).json({ error: "No reels found" });

    const reels = data.items.map((r) => ({
      id: r.pk ?? r.id,
      shortcode: r.code ?? null,
      url: r.code ? `https://www.instagram.com/reel/${r.code}/` : null,
      caption: r.caption?.text ?? "",
      posted_at: r.taken_at ? new Date(r.taken_at * 1000).toISOString() : null,
      likes: r.like_count ?? null,
      comments: r.comment_count ?? null,
      plays: r.play_count ?? null,
      duration_seconds: r.video_duration
        ? Math.round(r.video_duration * 10) / 10 : null,
      video_url: r.video_versions?.[0]?.url ?? null,
      thumbnail: r.image_versions2?.candidates[0]?.url ?? null,
    }));
    res.json({ total: reels.length, reels });
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch data", details: e.message });
  }
});

// GET /stories?username=
app.get("/stories", async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: "Username required" });
  try {
    const userId = await fetchUserId(username);
    const data = await igFetch(
      `https://i.instagram.com/api/v1/feed/user/${userId}/reel_media/`
    );
    if (!data.items?.length) return res.status(404).json({ error: "No stories found" });

    const stories = data.items.map((s) => ({
      id: s.id,
      type: s.media_type === 1 ? "photo" : s.media_type === 2 ? "video" : "unknown",
      posted_at: new Date(s.taken_at * 1000).toISOString(),
      expires_at: new Date((s.taken_at + 86400) * 1000).toISOString(),
      image_url: s.image_versions2?.candidates[0]?.url ?? null,
      video_url: s.video_versions?.[0]?.url ?? null,
    }));
    res.json({ total: stories.length, stories });
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch data", details: e.message });
  }
});

module.exports = app;
