/**
 * ChatPanel — Slide-out in-meeting chat panel.
 *
 * Messages are ephemeral (socket-based, not persisted).
 * Supports auto-scroll and Enter-to-send.
 */

import { useRef, useEffect, useState } from 'react';
import type { ChatMessage } from '../services/signaling';
import './ChatPanel.css';

interface ChatPanelProps {
  isOpen: boolean;
  messages: ChatMessage[];
  onSend: (message: string) => void;
  onClose: () => void;
}

export function ChatPanel({ isOpen, messages, onSend, onClose }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [isOpen]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    onSend(input);
    setInput('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    }
  }

  function formatTime(timestamp: number) {
    const d = new Date(timestamp);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div className={`chat-panel ${isOpen ? 'chat-panel--open' : ''}`}>
      <div className="chat-panel-header">
        <h3>Chat</h3>
        <button className="chat-panel-close" onClick={onClose} title="Close chat">
          ✕
        </button>
      </div>

      <div className="chat-panel-messages">
        {messages.length === 0 && (
          <div className="chat-panel-empty">
            <p>No messages yet</p>
            <p className="chat-panel-empty-hint">Messages are not saved after the meeting ends.</p>
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`chat-msg ${msg.from === 'self' ? 'chat-msg--self' : 'chat-msg--peer'}`}
          >
            <div className="chat-msg-meta">
              <span className="chat-msg-name">
                {msg.from === 'self' ? 'You' : msg.displayName}
              </span>
              <span className="chat-msg-time">{formatTime(msg.timestamp)}</span>
            </div>
            <div className="chat-msg-body">{msg.message}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-panel-input" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          autoComplete="off"
          maxLength={500}
        />
        <button type="submit" disabled={!input.trim()} title="Send">
          ▸
        </button>
      </form>
    </div>
  );
}
