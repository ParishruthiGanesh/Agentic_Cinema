"use client";

import { useParams } from "next/navigation";
import { FamilyPage } from "@/components/family";
import { ChildEditor } from "@/components/ChildEditor";

export default function EditKidPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <FamilyPage>
      <div className="studio-embed rounded-2xl bg-ink-950 p-5 text-ink-100">
        <ChildEditor id={id} family />
      </div>
    </FamilyPage>
  );
}
