# 📊 SocialScrape — Instagram Public Data Analytics API

> **Final Year Project — Bachelor of Technology (Computer Science)**
> Department of Computer Science & Engineering

---

## 📌 Project Overview

**SocialScrape** is a RESTful API service built as part of a Final Year undergraduate research project focused on **Social Media Data Analytics and Public Profile Monitoring**. The system fetches publicly available data from Instagram profiles and posts for research, analysis, and visualization purposes.

This project explores concepts in:
- **Web scraping & API design** using Node.js and Express
- **Cloud-native serverless deployment** on Vercel
- **Proxy-based request routing** for reliability
- **Social media data modeling** for academic analysis

---

## 🎯 Research Objectives

1. Study the structure of social media platform APIs and their public endpoints
2. Build a lightweight backend service to aggregate public social data
3. Demonstrate deployment of serverless REST APIs using modern cloud platforms
4. Analyze rate-limiting, caching, and proxy strategies in production systems
5. Provide a dataset pipeline for social media sentiment analysis (future scope)

---

## ⚠️ Disclaimer

> This project is developed **strictly for educational and academic research purposes** as part of a university final year project.
>
> - Only **publicly available** Instagram profile data is accessed (no private accounts)
> - No user passwords, private messages, or sensitive data are collected or stored
> - This tool does **not** bypass any authentication systems
> - Data fetched is used solely for academic analysis and is **not stored or redistributed**
> - Usage must comply with Instagram's [Terms of Service](https://help.instagram.com/581066165581870) and applicable laws
> - The authors do not endorse any commercial or malicious use of this software

---

## 🏗️ System Architecture

```
Client Request
      │
      ▼
 Vercel Edge (Serverless Function)
      │
      ▼
 Express.js API Layer
      │
      ├─── /profile  ──► Instagram Public Graph API
      ├─── /posts    ──► Instagram Public Media Endpoint
      ├─── /reels    ──► Instagram Reels Endpoint
      └─── /image    ──► Image Proxy (CORS-safe)
```

---

## 🚀 API Endpoints

### `GET /profile?username={username}`
Returns public profile metadata for a given Instagram username.

**Response:**
```json
{
  "username": "example",
  "full_name": "Example User",
  "bio": "This is a bio",
  "followers": 12400,
  "following": 350,
  "posts": 87,
  "profile_pic": "https://...",
  "is_verified": false,
  "is_private": false
}
```

---

### `GET /posts?username={username}&limit={n}`
Returns the most recent public posts of a user (max 25).

**Response:**
```json
{
  "username": "example",
  "count": 12,
  "posts": [
    {
      "id": "...",
      "shortcode": "...",
      "type": "GraphImage",
      "caption": "Post caption here",
      "likes": 420,
      "comments": 30,
      "timestamp": 1720000000,
      "url": "https://..."
    }
  ]
}
```

---

### `GET /reels?username={username}`
Returns public reels from the user's profile.

---

### `GET /image?url={encoded_image_url}`
Proxy endpoint to serve Instagram CDN images with proper CORS headers (for frontend integration).

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20.x |
| Framework | Express.js 4.x |
| Deployment | Vercel Serverless Functions |
| Request Layer | cURL via child_process |
| Language | JavaScript (CommonJS) |

---

## 📦 Local Setup

### Prerequisites
- Node.js >= 18.x
- npm or yarn

### Installation

```bash
git clone https://github.com/organicsmm/screper.git
cd screper
npm install
```

### Environment Variables

Create a `.env` file in the root directory:

```env
SESSION_COOKIE=your_instagram_session_cookie
PROXY_URL=your_proxy_url         # optional, for production reliability
```

> **Note:** The `SESSION_COOKIE` must be from a valid Instagram session. This is used to authenticate API requests to Instagram's internal endpoints. For research purposes, use a dedicated test account.

### Run Locally

```bash
npm start
# API available at http://localhost:3000
```

---

## ☁️ Vercel Deployment

1. Fork or clone this repository
2. Connect your GitHub account to [Vercel](https://vercel.com)
3. Import the repository and deploy
4. Set the following environment variables in **Vercel → Project Settings → Environment Variables**:

| Variable | Description |
|----------|-------------|
| `SESSION_COOKIE` | Instagram session cookie |
| `PROXY_URL` | Proxy URL (optional) |

---

## 📁 Project Structure

```
screper/
├── api/
│   └── index.js         # Main Express API handler (Vercel entry point)
├── vercel.json          # Vercel routing configuration
├── package.json         # Node.js dependencies
├── .gitignore           # Git ignore rules
└── README.md            # Project documentation
```

---

## 🔬 Academic Context

This project was developed under the supervision of faculty at the Department of Computer Science & Engineering as part of the **B.Tech Final Year Project** curriculum.

**Topics Covered:**
- RESTful API design principles
- Serverless computing (FaaS) architecture
- HTTP request proxying and header manipulation
- Cloud deployment pipelines (CI/CD via GitHub → Vercel)
- Social media data formats (JSON graph structures)

---

## 📄 License

This project is licensed under the **MIT License** — see [LICENSE](LICENSE) for details.

It is intended **only for educational use**. Commercial use is prohibited.

---

## 👨‍💻 Authors

- **Final Year Project Group** — B.Tech Computer Science
- Academic Year: 2024–2025

---

## 🙏 Acknowledgements

- Express.js community
- Vercel platform documentation
- Open-source contributors whose libraries made this possible
