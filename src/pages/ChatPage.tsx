import { useLiveQuery } from "dexie-react-hooks";
import { MenuIcon, SendIcon, VolumeIcon } from "lucide-react";
import ollama from "ollama/browser";
import { useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ChatMessage } from "~/components/ChatMessage";
import { ThoughtMessage } from "~/components/ThoughtMessage";
import { Button } from "~/components/ui/button";
import { SidebarTrigger } from "~/components/ui/sidebar";
import { Textarea } from "~/components/ui/textarea";
import { db } from "~/lib/dexie";

const ChatPage = () => {
  const [textInput, setTextInput] = useState("");
  const [streamedThought, setStreamedThought] = useState("");
  const [streamedMessage, setStreamedMessage] = useState("");
  const navigate = useNavigate();

  const scrollToBottomRef = useRef<HTMLDivElement>(null);

  const params = useParams();

  const messages = useLiveQuery(
    () => db.getMessagesForThread(params.threadId as string),
    [params.threadId]
  );

  const handleSubmit = async () => {
    try {
      await db.createMessage({
        content: textInput,
        role: "user",
        threadId: params.threadId as string,
        thought: "",
      });

      setTextInput("");

      const stream = await ollama.chat({
        model: "schroneko/gemma-2-2b-jpn-it",
        // model: "deepseek-r1:1.5b",
        messages: [
          // ...(messages || ([] as DEX_Message[]))
          //   .slice(0, 10)
          //   .map((message) => ({
          //     role: message.role,
          //     content: message.content,
          //   })),
          {
            role: "user",
            content: textInput.trim(),
          },
        ],
        stream: true,
      });

      let fullThought = "";
      let fullContent = "";

      let outputMode: "think" | "response" = "think";

      for await (const part of stream) {
        if (outputMode === "think") {
          if (
            !(
              part.message.content.includes("<think>") ||
              part.message.content.includes("</think>")
            )
          ) {
            fullThought += part.message.content;
          }

          setStreamedThought(fullThought);

          if (part.message.content.includes("</think>")) {
            outputMode = "response";
          }
        } else {
          fullContent += part.message.content;
          setStreamedMessage(
            (prevMessage) => prevMessage + part.message.content
          );
        }
      }

      const cleanThought = fullThought.replace(/<\/?think>/g, "");
      setStreamedThought(cleanThought);

      await db.createMessage({
        content: fullContent.trim(),
        role: "assistant",
        threadId: params.threadId as string,
        thought: cleanThought,
      });

      setStreamedThought("");
      setStreamedMessage("");
    } catch (error) {
      console.error(error);
    }
  };

  const handleTextareaChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    setTextInput(event.target.value);
  };

  const handleScrollToBottom = () => {
    scrollToBottomRef.current?.scrollIntoView();
  };

  useLayoutEffect(() => {
    handleScrollToBottom();
  }, [messages, streamedMessage, streamedThought]);

  return (
    <div className="flex flex-col flex-1">
      <header className="flex items-center px-4 h-16 border-b justify-between">
        <div className="flex flex-row items-center gap-2">
          <SidebarTrigger>
            <MenuIcon className="h-4 w-4" />
          </SidebarTrigger>
          <img
            src="/akane.jpg"
            alt="logo"
            width={32}
            height={32}
            className="rounded-full w-8 h-8 object-cover"
          />
          <div className="flex flex-col">
            <h1 className="text-xl font-bold">あかねっち</h1>
            <p className="text-sm text-gray-500">日本語で会話するAI</p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            navigate("/voice/" + params.threadId);
          }}
        >
          <VolumeIcon className="w-4 h-4" />
          <span>Voice Mode</span>
        </Button>
      </header>
      <main className="flex-1 overflow-auto p-4 w-full relative">
        <div className="mx-auto space-y-4 pb-20 max-w-screen-md">
          {messages?.map((message, index) => (
            <ChatMessage
              key={index}
              role={message.role}
              content={message.content}
              thought={message.thought}
            />
          ))}

          {streamedThought && <ThoughtMessage thought={streamedThought} />}

          {streamedMessage && (
            <ChatMessage role="assistant" content={streamedMessage} />
          )}

          <div ref={scrollToBottomRef}></div>
        </div>
      </main>
      <footer className="border-t p-4">
        <div className="max-w-3xl mx-auto flex gap-2">
          <Textarea
            className="flex-1 font-medium"
            placeholder="Type your message here..."
            rows={5}
            onChange={handleTextareaChange}
            value={textInput}
          />
          <Button onClick={handleSubmit} type="button">
            <SendIcon className="w-4 h-4" />
          </Button>
        </div>
      </footer>
    </div>
  );
};

export default ChatPage;
