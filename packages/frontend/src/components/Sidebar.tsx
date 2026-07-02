import { Database } from "lucide-react";
import type React from "react";
import { useState } from "react";
import ConversationHistory from "./ConversationHistory";
import KnowledgeBasePanel from "./KnowledgeBasePanel";
import NewChatButton from "./NewChatButton";

const Sidebar: React.FC = () => {
  const [isKnowledgeOpen, setIsKnowledgeOpen] = useState(false);

  return (
    <aside className="w-[240px] h-full border-r border-red-200 bg-[#f5f0e8] flex flex-col shrink-0">
      <div className="p-4">
        <NewChatButton />
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        <div className="text-[12px] font-medium text-red-400 px-2.5 mb-2">历史对话</div>
        <ConversationHistory />
      </div>

      <div className="p-3 border-t border-red-100">
        <button
          type="button"
          onClick={() => setIsKnowledgeOpen(true)}
          className="w-full h-10 flex items-center gap-2.5 px-3 rounded-lg text-gray-700 hover:bg-white hover:text-red-700 transition-colors"
        >
          <Database size={16} className="text-red-500 shrink-0" />
          <span className="text-[13px] font-medium">知识库</span>
        </button>
      </div>

      <KnowledgeBasePanel open={isKnowledgeOpen} onClose={() => setIsKnowledgeOpen(false)} />
    </aside>
  );
};

export default Sidebar;
