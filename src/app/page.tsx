import { redirect } from "next/navigation";

/** The game repository opens directly into the live Ludo client. */
export default function GameHome() {
  redirect("/play");
}
