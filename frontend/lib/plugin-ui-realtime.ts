'use client';

import { useEffect, useRef } from 'react';
import { getCurrentUser } from './api';
import { getSocket } from './messageSocket';

export function usePluginUiRealtime(pluginId: string, subscriptions: Array<{ event: string }> | undefined, refresh: () => void | Promise<void>) {
  const refreshRef = useRef(refresh); refreshRef.current = refresh;
  useEffect(() => {
    if (!subscriptions?.length) return;
    const socket = getSocket(); let active = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const handlers = subscriptions.map((subscription) => {
      const event = `plugin:${pluginId}:${subscription.event}`;
      const handler = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { if (active) void refreshRef.current(); }, 150); };
      socket.on(event, handler); return { event, handler };
    });
    const join = async () => { const user = await getCurrentUser(); if (active && user?.userId) socket.emit('plugin:join-user', user.userId); };
    void join(); socket.on('connect', join);
    return () => { active = false; if (timer) clearTimeout(timer); socket.off('connect', join); handlers.forEach(({ event, handler }) => socket.off(event, handler)); };
  }, [pluginId, JSON.stringify(subscriptions)]);
}
