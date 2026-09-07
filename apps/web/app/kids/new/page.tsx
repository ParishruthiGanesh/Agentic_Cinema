"use client";

import { FamilyPage } from "@/components/family";
import { ChildEditor } from "@/components/ChildEditor";

export default function NewKidPage() {
  return (
    <FamilyPage>
      <div className="studio-embed rounded-2xl bg-ink-950 p-5 text-ink-100">
        <ChildEditor id="new" family />
      </div>
    </FamilyPage>
  );
}
