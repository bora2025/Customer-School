'use client';

import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

let _socket: Socket | null = null;

function getSocketBase(): string {
  const url = process.env.NEXT_PUBLIC_API_URL ?? '';
  if (url) return url;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

export function getSocket(): Socket {
  if (!_socket) {
    _socket = io(getSocketBase(), {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      autoConnect: true,
    });
  }
  return _socket;
}

export interface IncomingMessage {
  id: string;
  content: string;
  createdAt: string;
  readAt: string | null;
  senderId: string;
  receiverId: string;
  sender: { id: string; name: string; photo: string | null };
  receiver: { id: string; name: string; photo: string | null };
}

/**
 * Subscribes to message:new + message:read for the given userId.
 * Joins the `user-${userId}` room on connect.
 */
export function useMessageSocket(
  userId: string | undefined,
  handlers: {
    onMessage?: (msg: IncomingMessage) => void;
    onRead?: (data: { by: string }) => void;
    onAnnouncement?: (a: { id: string; title: string }) => void;
    onTyping?: (data: { from: string; isTyping: boolean }) => void;
  },
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!userId) return;
    const socket = getSocket();
    const join = () => socket.emit('joinUser', userId);
    join();
    socket.on('connect', join);

    const onMessage = (m: IncomingMessage) => handlersRef.current.onMessage?.(m);
    const onSent = (m: IncomingMessage) => handlersRef.current.onMessage?.(m);
    const onRead = (d: { by: string }) => handlersRef.current.onRead?.(d);
    const onAnnouncement = (a: { id: string; title: string }) =>
      handlersRef.current.onAnnouncement?.(a);
    const onTyping = (d: { from: string; isTyping: boolean }) =>
      handlersRef.current.onTyping?.(d);

    socket.on('message:new', onMessage);
    socket.on('message:sent', onSent);
    socket.on('message:read', onRead);
    socket.on('plugin:wattanam.announcements:announcement:new', onAnnouncement);
    socket.on('typing', onTyping);

    return () => {
      socket.off('connect', join);
      socket.off('message:new', onMessage);
      socket.off('message:sent', onSent);
      socket.off('message:read', onRead);
      socket.off('plugin:wattanam.announcements:announcement:new', onAnnouncement);
      socket.off('typing', onTyping);
      socket.emit('leaveUser', userId);
    };
  }, [userId]);
}

export function emitTyping(from: string, to: string, isTyping: boolean) {
  const socket = getSocket();
  socket.emit('typing', { from, to, isTyping });
}
