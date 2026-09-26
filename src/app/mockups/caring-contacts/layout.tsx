import type { ReactNode } from "react";

import { CaringContactPrototypeProvider } from "@/components/caring-contacts/mockups/routable-suite";
import "../mockups.css";

// Standalone extract: the original wrapped this in PsychSift's DeveloperAreaGate (an admin
// sign-in screen for the whole PsychSift site). That gate is not part of Caring Contacts, so it
// is omitted here. These are design prototypes with invented data only.
export default function CaringContactMockupLayout({ children }: { children: ReactNode }) {
  return <CaringContactPrototypeProvider>{children}</CaringContactPrototypeProvider>;
}
