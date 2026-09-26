import { notFound } from "next/navigation";

import { CaringContactRoutePage } from "../../route-page";

export function generateStaticParams() {
  return [{ contactId: "SYN-CONTACT-004" }];
}

export default async function CaringContactContactPage({ params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params;
  if (contactId !== "SYN-CONTACT-004") notFound();
  return <CaringContactRoutePage />;
}
