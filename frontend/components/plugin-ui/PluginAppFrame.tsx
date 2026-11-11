"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import {
  createRateLimiter,
  parsePluginUiMessage,
  pluginUiAssetUrl,
  PLUGIN_UI_PROTOCOL,
} from "../../lib/plugin-ui-bridge";

/**
 * A plugin-owned screen (`app` component). The plugin's signed ui/ document runs in a sandboxed
 * iframe WITHOUT allow-same-origin: an opaque origin with no access to school cookies, storage or
 * DOM, and (by its CSP) no network. Everything goes through this bridge, which only forwards calls
 * to the plugin's own API as the signed-in user. See lib/plugin-ui-bridge.ts and docs/plugin-ui-apps.md.
 */
export default function PluginAppFrame({
  pluginId,
  pluginVersion,
  title,
  entry,
  params,
  height = "auto",
  minHeight = 320,
}: {
  pluginId: string;
  pluginVersion?: string;
  title?: string;
  entry: string;
  params: Record<string, string>;
  height?: "auto" | "fill";
  minHeight?: number;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const router = useRouter();
  const [frameHeight, setFrameHeight] = useState(minHeight);
  const allow = useMemo(() => createRateLimiter(), []);
  const src = pluginVersion ? pluginUiAssetUrl(pluginId, pluginVersion, entry) : null;

  useEffect(() => {
    const send = (message: Record<string, unknown>) => {
      // The sandboxed document has an opaque origin, so "*" is the only possible target origin.
      // The message goes to this specific iframe's window object only.
      frame.current?.contentWindow?.postMessage({ protocol: PLUGIN_UI_PROTOCOL, ...message }, "*");
    };
    const theme = () => {
      const style = getComputedStyle(document.documentElement);
      const token = (name: string) => style.getPropertyValue(name).trim();
      return {
        primary: token("--color-primary"), primaryDark: token("--color-primary-dark"),
        text: token("--color-text"), textSecondary: token("--color-text-secondary"),
        border: token("--color-input-border"), background: token("--color-input-bg"),
        fontFamily: token("--font-inter"),
      };
    };
    const onMessage = async (event: MessageEvent) => {
      // Only messages from THIS frame; anything else on the page is ignored.
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const message = parsePluginUiMessage(event.data);
      if (!message) return;
      if (message.type === "ready") {
        send({ type: "init", pluginId, pluginVersion, params, language: document.documentElement.lang || "en", theme: theme() });
        return;
      }
      if (message.type === "resize") {
        if (height === "auto") setFrameHeight(Math.max(minHeight, message.height));
        return;
      }
      if (message.type === "navigate") {
        router.push(`/plugins/${encodeURIComponent(pluginId)}/${message.routePath}`);
        return;
      }
      if (!allow()) {
        send({ type: "response", id: message.id, status: 429, body: { message: "Too many requests from this screen" } });
        return;
      }
      const query = message.query ? `?${new URLSearchParams(message.query).toString()}` : "";
      try {
        const response = await apiFetch(`/api/plugin-api/${encodeURIComponent(pluginId)}/${message.path}${query}`, {
          method: message.method,
          headers: message.body !== undefined ? { "Content-Type": "application/json" } : undefined,
          body: message.body !== undefined ? JSON.stringify(message.body) : undefined,
        });
        const text = await response.text();
        let body: unknown = null;
        try { body = text ? JSON.parse(text) : null; } catch { body = { message: "The plugin returned a non-JSON response" }; }
        send({ type: "response", id: message.id, status: response.status, body });
      } catch {
        send({ type: "response", id: message.id, status: 0, body: { message: "Network error" } });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [allow, height, minHeight, params, pluginId, pluginVersion, router]);

  if (!src) {
    return <section className="card p-5 text-sm text-slate-500">This screen needs a newer school core to show {title || "this plugin screen"}.</section>;
  }
  return (
    <section className="card overflow-hidden p-0">
      <iframe
        ref={frame}
        title={title || `${pluginId} screen`}
        src={src}
        sandbox="allow-scripts allow-forms allow-modals allow-downloads"
        referrerPolicy="no-referrer"
        className="block w-full border-0"
        style={{ height: height === "fill" ? "calc(100vh - 12rem)" : frameHeight, minHeight }}
      />
    </section>
  );
}
