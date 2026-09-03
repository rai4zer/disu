import { redirect } from "next/navigation";

/**
 * `/quant` moved onto the instrument page as a tab.
 *
 * The module opened by asking which ticker you meant, which was a detour around
 * the page you were already heading for. It now runs from
 * `/instrument/<symbol>?tab=quant`, where the ticker is already settled.
 *
 * The redirect stays because the old path is still reachable from outside our
 * own navigation — a bookmark, and a link someone shared alongside a job they
 * ran. Sending them to the dashboard beats a 404, since we cannot know from
 * this URL which instrument they wanted.
 */
export default function QuantRedirect() {
  redirect("/dashboard");
}
