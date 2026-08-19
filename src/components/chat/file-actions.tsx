"use client"

import * as React from "react"
import { GitCommit, History, Undo2, FileDiff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface FileActionsProps {
  filePath: string | null
}

export function FileActions({ filePath }: FileActionsProps) {
  const [diff, setDiff] = React.useState<string | null>(null)
  const [showDiff, setShowDiff] = React.useState(false)

  if (!filePath) return null

  const getDiff = async () => {
    try {
      const res = await fetch(`/api/workspace/diff?file=${encodeURIComponent(filePath)}`)
      const data = await res.json()
      setDiff(data.diff || "")
      setShowDiff(true)
      if (!data.diff) toast.info("لا تغييرات في هذا الملف")
    } catch {
      toast.error("فشل جلب الفروقات")
    }
  }

  const revert = async () => {
    try {
      const res = await fetch("/api/workspace/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: filePath }),
      })
      const data = await res.json()
      if (data.success) toast.success(`تم التراجع: ${filePath}`)
      else toast.error("فشل التراجع")
    } catch {
      toast.error("فشل التراجع")
    }
  }

  const getHistory = async () => {
    try {
      const res = await fetch(`/api/workspace/history?file=${encodeURIComponent(filePath)}`)
      const data = await res.json()
      if (data.history?.length > 0) {
        const msg = data.history.map((h: any) => `${h.hash} ${h.message}`).join("\n")
        toast.info(`تاريخ ${filePath}:\n${msg}`, { duration: 8000 })
      } else {
        toast.info("لا تاريخ لهذا الملف")
      }
    } catch {
      toast.error("فشل جلب التاريخ")
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={getDiff} title="الفروقات">
        <FileDiff className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={revert} title="تراجع">
        <Undo2 className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={getHistory} title="التاريخ">
        <History className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
