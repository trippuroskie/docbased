import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function HubRedirect({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string }>;
}) {
  const { doc } = await searchParams;
  redirect(doc ? `/?doc=${encodeURIComponent(doc)}` : "/");
}
