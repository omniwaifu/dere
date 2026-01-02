import { createFileRoute } from "@tanstack/react-router";
import { ChatView } from "@/components/chat/ChatView";

export const Route = createFileRoute("/chat/$sessionId")({
  component: ChatPage,
});

function ChatPage() {
  const { sessionId } = Route.useParams();
  return <ChatView sessionId={sessionId} />;
}
