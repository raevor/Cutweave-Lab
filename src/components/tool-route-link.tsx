import Link from "next/link";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import type { ToolSlug } from "@/lib/tool-catalog";

type ToolRouteLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  children: ReactNode;
  toolSlug: ToolSlug;
};

export function ToolRouteLink({ toolSlug, children, ...props }: ToolRouteLinkProps) {
  const href = `/lab/${toolSlug}`;

  if (toolSlug === "anime-face-recognition") {
    return <a href={href} {...props}>{children}</a>;
  }

  return <Link href={href} {...props}>{children}</Link>;
}
