import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "jsr:@supabase/supabase-js@2";
import * as kv from "./kv_store.tsx";

const app = new Hono();

app.use("*", cors());
app.use("*", logger(console.log));

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Health check endpoint
app.get("/make-server-7871649b/health", (c) => {
  return c.json({ status: "ok", message: "Stackify server is running" });
});

// Join waitlist endpoint
app.post("/make-server-7871649b/waitlist", async (c) => {
  try {
    const { email } = await c.req.json();

    if (!email || !email.includes("@")) {
      return c.json({ error: "Invalid email address" }, 400);
    }

    // Check if email already exists
    const existingEmails = await kv.getByPrefix("waitlist:");
    const emailExists = existingEmails.some((item) => item.value === email);

    if (emailExists) {
      return c.json({ error: "Email already registered" }, 400);
    }

    // Store email with timestamp
    const timestamp = new Date().toISOString();
    const key = `waitlist:${timestamp}:${email}`;
    await kv.set(key, email);

    console.log(`Waitlist signup: ${email} at ${timestamp}`);

    return c.json({ success: true, message: "Successfully joined the waitlist!" });
  } catch (error) {
    console.error("Error adding to waitlist:", error);
    return c.json({ error: "Failed to join waitlist. Please try again." }, 500);
  }
});

// Get all waitlist emails (optional - for admin purposes)
app.get("/make-server-7871649b/waitlist", async (c) => {
  try {
    const emails = await kv.getByPrefix("waitlist:");
    return c.json({ 
      count: emails.length, 
      emails: emails.map(e => ({ email: e.value, key: e.key }))
    });
  } catch (error) {
    console.error("Error fetching waitlist:", error);
    return c.json({ error: "Failed to fetch waitlist" }, 500);
  }
});

Deno.serve(app.fetch);
