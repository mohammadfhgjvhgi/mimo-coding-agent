// MiMo AI — Agent icon helper (maps icon names to lucide components)

import {
  Network,
  Search,
  ListChecks,
  Code2,
  Bug,
  ShieldCheck,
  Lock,
  Eye,
  FileText,
  BrainCircuit,
  Building2,
  ScanSearch,
  Wand2,
  Database,
  ClipboardList,
  type LucideIcon,
} from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  Network,
  Search,
  ListChecks,
  Code2,
  Bug,
  ShieldCheck,
  Lock,
  Eye,
  FileText,
  BrainCircuit,
  Building2,
  ScanSearch,
  Wand2,
  Database,
  ClipboardList,
};

export function getAgentIcon(name: string): LucideIcon {
  return ICON_MAP[name] ?? Network;
}
