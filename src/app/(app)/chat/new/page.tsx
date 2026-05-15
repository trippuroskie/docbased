import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function NewChatRedirect({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  redirect(q ? `/?q=${encodeURIComponent(q)}` : "/");
}
