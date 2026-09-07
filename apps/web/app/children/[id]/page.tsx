"use client";

import { useParams } from "next/navigation";
import { ChildEditor } from "@/components/ChildEditor";

export default function ChildPage() {
  const { id } = useParams<{ id: string }>();
  return <ChildEditor id={id} />;
}
