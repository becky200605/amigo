import { ChevronLeft, Menu } from "lucide-react";
import { useConnection } from "@/sdk";
import type { ConnectionStatus } from "@/sdk/types/store";
import { useSidebar } from "./Layout";

const statusConfig: Record<ConnectionStatus, { label: string; color: string; pulse?: boolean }> = {
  connected: { label: "已连接", color: "bg-green-400" },
  connecting: { label: "连接中...", color: "bg-yellow-400", pulse: true },
  reconnecting: { label: "重连中...", color: "bg-yellow-400", pulse: true },
  disconnected: { label: "已断开", color: "bg-red-300" },
};

const Header: React.FC = () => {
  const { status: connectionStatus } = useConnection();
  const { isOpen, toggle } = useSidebar();
  const config = statusConfig[connectionStatus];

  return (
    <header className="h-12 border-b border-red-800 bg-red-700 flex items-center justify-between px-4 z-20">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          className="p-1.5 rounded-lg text-red-200 hover:bg-red-600 hover:text-white transition-all"
          aria-label={isOpen ? "收起侧边栏" : "展开侧边栏"}
        >
          {isOpen ? <ChevronLeft className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
        </button>
        <div className="text-sm font-semibold text-white tracking-tight">社区智能体</div>
      </div>
      <div className="flex items-center gap-1.5 px-2 py-0.5">
        <span
          className={`w-1.5 h-1.5 rounded-full ${config.color} ${config.pulse ? "animate-pulse" : ""}`}
        />
        <span className="text-[11px] font-medium text-red-100">{config.label}</span>
      </div>
    </header>
  );
};

export default Header;
