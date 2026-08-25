import { TopBar } from "@/components/TopBar";
import { ProjectManager } from "@/components/projects/ProjectManager";
import { requireApprovedPage } from "@/lib/data/session";
import { listProjects } from "@/lib/data/projects";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const actor = await requireApprovedPage("/projects");
  const projects = await listProjects(actor);

  return (
    <div className="app">
      <TopBar />
      <div className="shell shell-narrow">
        <ProjectManager initial={projects} />
      </div>
    </div>
  );
}
