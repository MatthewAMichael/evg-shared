// Vercel Fluid Compute — no timeout issues for long AI responses
export const config = {
  runtime: "nodejs",
  maxDuration: 300,
};

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Password check
  const { password, ...body } = typeof req.body === "string"
    ? JSON.parse(req.body) : req.body;

  if (!process.env.ACCESS_PASSWORD) {
    return res.status(500).json({ error: "ACCESS_PASSWORD not configured" });
  }
  if (password !== process.env.ACCESS_PASSWORD) {
    return res.status(401).json({ error: "Invalid password" });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  }

  try {
    // Use Anthropic streaming to keep connection alive
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
      },
      body: JSON.stringify({ ...body, stream: true }),
    });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.status(200);

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const evt = JSON.parse(data);
          if (evt.type === "content_block_delta" && evt.delta?.text) {
            fullText += evt.delta.text;
          }
        } catch {}
      }
    }

    res.write(`data: ${JSON.stringify({ fullText })}\n\n`);
    res.end();

  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: "Server error: " + error.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }
};
