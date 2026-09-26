import { redirect } from "next/navigation";

// Standalone extract: the app has one product, so the home page opens it.
export default function Home() {
  redirect("/caring-contacts");
}
