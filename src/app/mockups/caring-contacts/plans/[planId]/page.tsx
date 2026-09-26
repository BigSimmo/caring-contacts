import { notFound } from "next/navigation";

import { CaringContactRoutePage } from "../../route-page";

export function generateStaticParams() {
  return [{ planId: "SYN-PLAN-001" }];
}

export default async function CaringContactPlanPage({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params;
  if (planId !== "SYN-PLAN-001") notFound();
  return <CaringContactRoutePage />;
}
