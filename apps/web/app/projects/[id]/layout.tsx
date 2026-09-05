import { ProjectProvider } from "@/components/ProjectProvider";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectProvider id={id}>{children}</ProjectProvider>;
}
