const express = require("express");
const cors = require("cors");
const { execFile } = require("child_process");

const app = express();
app.use(cors());
app.use(express.json());
app.set("json spaces", 2);

// ── Config ───────────────────────────────────────────────────────────────────
const SESSION_COOKIES = [
  process.env.SESSION_COOKIE  || "sessionid=44649264153%3AECjH4bpBwnhLbZ%3A25%3AAYhue6Vz3eymdQ2aiTnzBQOIULrH1g9rH_z-JO_A1A",
  process.env.SESSION_COOKIE2 || "sessionid=76670837707%3A531WL8IMR66MaY%3A0%3AAYjUTyX5bpHZwA_nOkRzW09SacrLjfNH_RkuM6s55g",
];
const IG_USER_AGENT =
  "Instagram 155.0.0.37.107 (iPhone11,8; iOS 14_4; en_US; en-US; scale=2.00; 828x1792; 190542906)";

// ── Core fetch via curl ───────────────────────────────────────────────────────
function igFetchWithCookie(url, cookie) {
  return new Promise((resolve, reject) => {
    const args = ["-s",
      "-H", `User-Agent: ${IG_USER_AGENT}`,
      "-H", "Accept-Language: en-US",
      "-H", "X-IG-App-ID: 936619743392459",
      "-H", `Cookie: ${cookie}`,
      url
    ];
    execFile("curl", args, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`curl failed: ${stderr || err.message}`));
      const body = stdout.trim();
      if (!body) return reject(new Error("Empty response from Instagram"));
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error(`Invalid JSON: ${body.slice(0, 200)}`)); }
    });
  });
}

// Try each cookie in order; skip expired/challenged ones
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

function proxyImage(url) {
  return new Promise((resolve, reject) => {
    const args = ["-s"];
    args.push(
      "-H", "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X)",
      "-H", "Referer: https://www.instagram.com/",
      url
    );
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
  if (id) return id;
  throw new Error("Invalid username or API error");
}

const mediaTypeLabel = (t) =>
  t === 1 ? "photo" : t === 2 ? "video" : t === 8 ? "carousel" : "unknown";

// ── Routes ────────────────────────────────────────────────────────────────────

// GET / — landing page
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
    a { color: #0072ff; text-decoration: none; }
    footer { margin-top: 3rem; font-size: 14px; color: #555; }
  </style>
</head>
<body>
  <h1>📸 Instagram Scraper API</h1>
  <p>Created by <a href="https://instagram.com/s4chiz" target="_blank">@s4chiz</a></p>
  <h2>Endpoints</h2>
  <ul>
    <li><code>GET /info?username=</code> — Profile info</li>
    <li><code>GET /posts?username=</code> — All posts with full details</li>
    <li><code>GET /reels?username=</code> — Reels</li>
    <li><code>GET /stories?username=</code> — Active stories</li>
    <li><code>GET /proxy?url=</code> — Instagram CDN image proxy</li>
  </ul>
  <footer>© 2025 @s4chiz. Built for educational use.</footer>
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
  if (!username) return res.status(400).json({ error: "Username parameter is required" });
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
      profile_url: `https://www.instagram.com/${user.username}/`,
    });
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch data", details: e.message });
  }
});

// GET /posts?username=
app.get("/posts", async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: "Username parameter is required" });
  try {
    const userId = await fetchUserId(username);

    // Fetch latest posts, capped at 25
    const MAX_POSTS = 25;
    const allItems = [];
    let nextMaxId = null;
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
      duration_seconds: post.video_duration
        ? Math.round(post.video_duration * 10) / 10
        : null,
      has_audio: post.has_audio ?? null,
      width: post.original_width,
      height: post.original_height,
      image_url: post.image_versions2?.candidates[0]?.url ?? null,
      video_url: post.video_versions?.[0]?.url ?? null,
      location: post.location
        ? { name: post.location.name, lat: post.location.lat, lng: post.location.lng }
        : null,
      accessibility_caption: post.accessibility_caption ?? null,
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
  if (!username) return res.status(400).json({ error: "Username parameter is required" });
  try {
    const userId = await fetchUserId(username);
    const data = await igFetch(`https://i.instagram.com/api/v1/clips/user/${userId}/`);

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
        ? Math.round(r.video_duration * 10) / 10
        : null,
      has_audio: r.has_audio ?? null,
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
  if (!username) return res.status(400).json({ error: "Username parameter is required" });
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
