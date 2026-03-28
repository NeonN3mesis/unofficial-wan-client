import { Fragment, useMemo } from "react";
import { parseChatTokens } from "../lib/chat-format";

interface ChatMessageBodyProps {
  body: string;
  currentUsername?: string | null;
  onMentionClick?: (username: string) => void;
}

export function ChatMessageBody({
  body,
  currentUsername,
  onMentionClick
}: ChatMessageBodyProps) {
  const tokens = useMemo(() => parseChatTokens(body), [body]);

  return (
    <div className="chat-body">
      {tokens.map((token, index) => {
        const key = `${token.type}-${index}`;

        if (token.type === "text") {
          return <Fragment key={key}>{token.content}</Fragment>;
        }

        if (token.type === "styled") {
          if (token.style === "strong") {
            return <strong key={key}>{token.content}</strong>;
          }

          if (token.style === "strike") {
            return <s key={key}>{token.content}</s>;
          }

          return <em key={key}>{token.content}</em>;
        }

        if (token.type === "link") {
          return (
            <a
              className="chat-link"
              href={token.href}
              key={key}
              rel="noreferrer noopener"
              target="_blank"
            >
              {token.content}
            </a>
          );
        }

        const isSelfMention =
          Boolean(currentUsername) && token.username.toLowerCase() === currentUsername?.toLowerCase();
        const className = `chat-mention ${isSelfMention ? "is-self" : ""}`.trim();

        if (!onMentionClick) {
          return (
            <span className={className} key={key}>
              {token.content}
            </span>
          );
        }

        return (
          <button
            className={`${className} is-actionable`}
            key={key}
            onClick={() => onMentionClick(token.username)}
            onMouseDown={(event) => event.preventDefault()}
            type="button"
          >
            {token.content}
          </button>
        );
      })}
    </div>
  );
}
