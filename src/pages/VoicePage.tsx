import { useLiveQuery } from "dexie-react-hooks";
import { Loader2, MenuIcon, MicIcon, MessageCircleIcon } from "lucide-react";
import ollama from "ollama/browser";
import { useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ChatMessage } from "~/components/ChatMessage";
import { ThoughtMessage } from "~/components/ThoughtMessage";
import { Button } from "~/components/ui/button";
import { SidebarTrigger } from "~/components/ui/sidebar";
import { db } from "~/lib/dexie";

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResult;
  length: number;
}

interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
  length: number;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: SpeechRecognitionErrorEvent) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

const VOICE_TIMEOUT = 1000;
const VOWEL_INTERVAL = 100; // Time between vowel changes in ms

const VoicePage = () => {
  const [streamedThought, setStreamedThought] = useState("");
  const [streamedMessage, setStreamedMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [currentVowel, setCurrentVowel] = useState<string>("");
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const vowelIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const navigate = useNavigate();
  const [streamedVoice, setStreamedVoice] = useState("");

  const getMouthShape = (text: string): string => {
    // Vowels and their variations
    const vowelMap = {
      あ: "a",
      い: "i",
      う: "u",
      え: "e",
      お: "o",
      ア: "a",
      イ: "i",
      ウ: "u",
      エ: "e",
      オ: "o",
      ぁ: "a",
      ぃ: "i",
      ぅ: "u",
      ぇ: "e",
      ぉ: "o",
      ァ: "a",
      ィ: "i",
      ゥ: "u",
      ェ: "e",
      ォ: "o",
    };

    // Consonants and their variations
    const consonantMap = {
      // K series
      か: "a",
      き: "i",
      く: "u",
      け: "e",
      こ: "o",
      カ: "a",
      キ: "i",
      ク: "u",
      ケ: "e",
      コ: "o",
      // S series
      さ: "a",
      し: "i",
      す: "u",
      せ: "e",
      そ: "o",
      サ: "a",
      シ: "i",
      ス: "u",
      セ: "e",
      ソ: "o",
      // T series
      た: "a",
      ち: "i",
      つ: "u",
      て: "e",
      と: "o",
      タ: "a",
      チ: "i",
      ツ: "u",
      テ: "e",
      ト: "o",
      // N series
      な: "a",
      に: "i",
      ぬ: "u",
      ね: "e",
      の: "o",
      ナ: "a",
      ニ: "i",
      ヌ: "u",
      ネ: "e",
      ノ: "o",
      // H series
      は: "a",
      ひ: "i",
      ふ: "u",
      へ: "e",
      ほ: "o",
      ハ: "a",
      ヒ: "i",
      フ: "u",
      ヘ: "e",
      ホ: "o",
      // M series
      ま: "a",
      み: "i",
      む: "u",
      め: "e",
      も: "o",
      マ: "a",
      ミ: "i",
      ム: "u",
      メ: "e",
      モ: "o",
      // Y series
      や: "a",
      ゆ: "u",
      よ: "o",
      ヤ: "a",
      ユ: "u",
      ヨ: "o",
      // R series
      ら: "a",
      り: "i",
      る: "u",
      れ: "e",
      ろ: "o",
      ラ: "a",
      リ: "i",
      ル: "u",
      レ: "e",
      ロ: "o",
      // W series
      わ: "a",
      を: "o",
      ワ: "a",
      ヲ: "o",
      // N
      ん: "a",
      ン: "a",
    };

    // Check for consonants first (more specific)
    for (const [char, shape] of Object.entries(consonantMap)) {
      if (text.includes(char)) return shape;
    }

    // Then check for vowels
    for (const [char, shape] of Object.entries(vowelMap)) {
      if (text.includes(char)) return shape;
    }

    return "a"; // Default mouth shape
  };

  const startVowelAnimation = (text: string) => {
    if (vowelIntervalRef.current) {
      clearInterval(vowelIntervalRef.current);
    }

    let currentIndex = 0;
    vowelIntervalRef.current = setInterval(() => {
      if (currentIndex >= text.length) {
        clearInterval(vowelIntervalRef.current!);
        setCurrentVowel("a");
        return;
      }

      const char = text[currentIndex];
      const mouthShape = getMouthShape(char);
      if (mouthShape) {
        console.log("mouth shape", mouthShape);
        setCurrentVowel(mouthShape);
      }
      currentIndex++;
    }, VOWEL_INTERVAL);
  };

  const startListening = () => {
    console.log("startListening");
    if (
      !("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
    ) {
      console.error("Speech recognition not supported");
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.lang = "ja-JP";
    recognitionRef.current.continuous = true;
    recognitionRef.current.interimResults = true;

    recognitionRef.current.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join("");

      // Clear existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      setStreamedVoice(transcript);
      // Set new timeout for auto-submit
      timeoutRef.current = setTimeout(() => {
        if (transcript.trim() && !loading) {
          stopListening();
          handleSubmit(transcript);
        }
      }, VOICE_TIMEOUT * 1.5);
    };

    recognitionRef.current.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
      stopListening();
    };

    recognitionRef.current.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current.start();
    setIsListening(true);
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  // Cleanup timeout on unmount
  useLayoutEffect(() => {
    return () => {
      stopListening();
    };
  }, []);

  const handlePlay = (text: string) => {
    const onlyJpText = text.replace(
      /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}]/gu,
      ""
    );

    console.log("playing ", onlyJpText);
    const synth = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(onlyJpText);
    u.lang = "ja-JP";
    u.rate = 1.2;
    u.pitch = 1.2;
    u.volume = 1.2;
    u.voice = synth.getVoices()[9];

    u.onstart = () => {
      startVowelAnimation(onlyJpText);
    };

    u.onend = () => {
      if (vowelIntervalRef.current) {
        clearInterval(vowelIntervalRef.current);
      }
      setCurrentVowel("");
    };

    synth.speak(u);
  };

  const scrollToBottomRef = useRef<HTMLDivElement>(null);

  const params = useParams();

  const messages = useLiveQuery(
    () => db.getMessagesForThread(params.threadId as string),
    [params.threadId]
  );

  const handleSubmit = async (text: string) => {
    try {
      if (loading) {
        return;
      }
      setLoading(true);
      console.log("handleSubmit", text);
      await db.createMessage({
        content: text,
        role: "user",
        threadId: params.threadId as string,
        thought: "",
      });

      const stream = await ollama.chat({
        model: "schroneko/gemma-2-2b-jpn-it",
        messages: [
          {
            role: "user",
            content:
              "[MAKE IT CONVERSATIONAL TWO WAYS, ONLY RESPOND IN JAPANESE]" +
              text.trim(),
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

      const onlyJpText = cleanThought.replace(
        /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}]/gu,
        ""
      );

      handlePlay(onlyJpText);
    } catch (error) {
      console.error(error);
    } finally {
      setStreamedThought("");
      setStreamedMessage("");
      setStreamedVoice("");
      setLoading(false);
    }
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
            navigate("/thread/" + params.threadId);
          }}
        >
          <MessageCircleIcon className="w-4 h-4" />
          <span>Chat Mode</span>
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
              onPlay={handlePlay}
            />
          ))}

          {loading && (
            <div className="flex justify-center items-center h-full">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          )}

          {streamedThought && <ThoughtMessage thought={streamedThought} />}

          {streamedMessage && (
            <ChatMessage role="assistant" content={streamedMessage} />
          )}

          <div ref={scrollToBottomRef}></div>
        </div>
      </main>
      <footer className="border-t p-4">
        <div>{streamedVoice}</div>
        <div className="max-w-3xl mx-auto flex justify-center">
          <Button
            onClick={toggleListening}
            type="button"
            variant={isListening ? "destructive" : "default"}
            size="lg"
            className="w-16 h-16 rounded-full"
          >
            <MicIcon
              className={`w-8 h-8 ${isListening ? "animate-pulse" : ""}`}
            />
          </Button>
        </div>
      </footer>
      <div className="fixed bottom-4 right-4 w-60 h-82 overflow-hidden">
        {currentVowel ? (
          <img
            src={`/vowel/akane-${currentVowel}.png`}
            alt={`Akane saying ${currentVowel}`}
            className="w-full h-full object-cover"
          />
        ) : (
          <img
            src="/vowel/akane-i.png"
            alt="Akane"
            className="w-full h-full object-cover"
          />
        )}
      </div>
    </div>
  );
};

export default VoicePage;
