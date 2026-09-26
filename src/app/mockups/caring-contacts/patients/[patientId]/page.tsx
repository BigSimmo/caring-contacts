import { notFound } from "next/navigation";

import { CaringContactRoutePage } from "../../route-page";

export function generateStaticParams() {
  return [{ patientId: "SYN-PATIENT-001" }];
}

export default async function CaringContactPatientPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  if (patientId !== "SYN-PATIENT-001") notFound();
  return <CaringContactRoutePage />;
}
