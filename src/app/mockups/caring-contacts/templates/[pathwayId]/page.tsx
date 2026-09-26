import { notFound } from "next/navigation";

import { CaringContactRoutePage } from "../../route-page";

export function generateStaticParams() {
  return [{ pathwayId: "SYN-PATHWAY-001" }];
}

export default async function CaringContactTemplatePage({ params }: { params: Promise<{ pathwayId: string }> }) {
  const { pathwayId } = await params;
  if (pathwayId !== "SYN-PATHWAY-001") notFound();
  return <CaringContactRoutePage />;
}
