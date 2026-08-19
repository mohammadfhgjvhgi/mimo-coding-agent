"use client";

import { useState } from "react";
import { useMimo } from "@/lib/mimo-store";
import { safeFetch } from "@/lib/safe-fetch";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FolderKanban, Plus, Trash2, Folder } from "lucide-react";
import { t } from "@/lib/i18n";

export function ProjectsPanel() {
  const { projects, locale, loadProjects } = useMimo();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("software");

  const createProject = async () => {
    if (!name.trim()) return;
    try {
      await safeFetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, type }),
      });
      setName("");
      setDescription("");
      setType("software");
      setShowForm(false);
      loadProjects();
    } catch {
      // error handled by safeFetch
    }
  };

  const deleteProject = async (id: string) => {
    try {
      await safeFetch(`/api/projects/${id}`, { method: "DELETE" });
      loadProjects();
    } catch {
      // ignore
    }
  };

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs text-muted-foreground">
          {projects.length} {locale === "ar" ? "مشروع" : "projects"}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => setShowForm(!showForm)}
        >
          <Plus className="w-3 h-3 mr-1" />
          {t("projects.new", locale)}
        </Button>
      </div>

      {showForm && (
        <Card className="p-3 space-y-2">
          <Input
            placeholder={t("projects.name", locale)}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 text-xs"
          />
          <Textarea
            placeholder={t("projects.description", locale)}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="text-xs min-h-[60px]"
            rows={2}
          />
          <div className="flex gap-2">
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="text-xs h-8 rounded-md border bg-background px-2 flex-1"
            >
              <option value="software">Software</option>
              <option value="hardware">Hardware</option>
              <option value="iot">IoT</option>
              <option value="research">Research</option>
              <option value="business">Business</option>
            </select>
            <Button size="sm" className="h-8 text-xs" onClick={createProject}>
              {locale === "ar" ? "إنشاء" : "Create"}
            </Button>
          </div>
        </Card>
      )}

      {projects.length === 0 && !showForm ? (
        <div className="p-4 text-center text-sm text-muted-foreground">
          <FolderKanban className="w-8 h-8 mx-auto mb-2 opacity-50" />
          {t("projects.empty", locale)}
        </div>
      ) : (
        projects.map((project) => (
          <Card key={project.id} className="p-2.5 group">
            <div className="flex items-start gap-2">
              <div className="w-7 h-7 rounded-lg bg-violet-500/20 flex items-center justify-center flex-shrink-0">
                <Folder className="w-3.5 h-3.5 text-violet-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold leading-tight truncate">
                  {project.name}
                </div>
                {project.description && (
                  <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                    {project.description}
                  </p>
                )}
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <Badge variant="outline" className="text-[9px] py-0">
                    {project.type}
                  </Badge>
                  {project._count && (
                    <>
                      <Badge variant="outline" className="text-[9px] py-0">
                        {project._count.conversations} {t("projects.conversations", locale)}
                      </Badge>
                      <Badge variant="outline" className="text-[9px] py-0">
                        {project._count.entities} {t("projects.entities", locale)}
                      </Badge>
                    </>
                  )}
                </div>
              </div>
              <button
                onClick={() => deleteProject(project.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-rose-500"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
