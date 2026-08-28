import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTool, primaryTools } from "@/lib/tool-catalog";
import { ToolWorkspace } from "./tool-workspace";

export function generateStaticParams() {
  return primaryTools.map((tool) => ({ tool: tool.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ tool: string }> }): Promise<Metadata> {
  const { tool: slug } = await params;
  const tool = getTool(slug);
  if (!tool) return {};
  return { title: tool.title, description: tool.description };
}

export default async function FocusedToolPage({ params }: { params: Promise<{ tool: string }> }) {
  const { tool: slug } = await params;
  const tool = getTool(slug);
  if (!tool) notFound();
  return <ToolWorkspace tool={tool} />;
}
