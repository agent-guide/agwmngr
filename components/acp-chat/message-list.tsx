"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "./types";
import { MessageBubble } from "./message-bubble";

interface MessageListProps {
  messages: ChatMessage[];
  onResolvePermission: (
    messageId: string,
    requestId: string,
    outcome: "selected" | "cancelled",
    optionId?: string,
  ) => Promise<void>;
}

export function MessageList({ messages, onResolvePermission }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom on new content unless the user scrolled up.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const nearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 120;
    if (nearBottom) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-slate-500">Send a message to start the conversation.</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full space-y-3 overflow-y-auto px-1 py-2">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} onResolvePermission={onResolvePermission} />
      ))}
      <div ref={endRef} />
    </div>
  );
}
