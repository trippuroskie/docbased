import { NextResponse } from "next/server";
import { z } from "zod";
import type OpenAI from "openai";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { openrouter as getOpenRouter } from "@/lib/ai/openrouter";
import { env, CHAT_MODEL_ALLOWLIST } from "@/lib/env";
import { SYSTEM_PROMPT, parseCitations } from "@/lib/chat";
import { TOOL_SPECS, dispatchTool, type ToolContext } from "@/lib/ai/tools";
import { getAccessibleSpaces } from "@/lib/auth";
import {
  effectiveChatModels,
  effectiveDefaultChatModel,
  getUserSettings,
} from "@/lib/settings";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_TOOL_ITERATIONS = 6;

const Body = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1).max(4000),
  spaceIds: z.array(z.string().uuid()).optional(),
  model: z.string().optional(),
  contextDocId: z.string().uuid().optional(),
});

type StreamedToolCall = {
  id: string;
  name: string;
  argumentsRaw: string;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = Body.parse(await request.json());

  // Authorize the model against the user's saved picker list, falling back
  // to the env allowlist if they haven't customized it. Both lists are
  // treated as trusted by the server — we never forward arbitrary user input
  // to OpenRouter without validation.
  const settings = await getUserSettings(user.id);
  const userAllowed = effectiveChatModels(settings);
  const requested = body.model;
  const fallbackDefault = effectiveDefaultChatModel(settings);
  let model: string;
  if (requested && userAllowed.includes(requested)) {
    model = requested;
  } else if (
    requested &&
    (CHAT_MODEL_ALLOWLIST as readonly string[]).includes(requested)
  ) {
    // Legacy/global allowlist fallback for users with no saved selection.
    model = requested;
  } else if (!requested) {
    model = fallbackDefault;
  } else {
    return NextResponse.json({ error: "model_not_allowed" }, { status: 400 });
  }

  const admin = createServiceClient();

  // Rate limit.
  const today = new Date().toISOString().slice(0, 10);
  const { data: usage } = await admin
    .from("chat_usage")
    .select("count")
    .eq("user_id", user.id)
    .eq("day", today)
    .maybeSingle();
  if ((usage?.count ?? 0) >= env.chatDailyLimit) {
    return NextResponse.json(
      { error: "rate_limited", limit: env.chatDailyLimit },
      { status: 429 },
    );
  }

  // Resolve conversation + load prior history (for multi-turn memory).
  let conversationId = body.conversationId;
  let priorHistory: { role: "user" | "assistant"; content: string }[] = [];
  if (!conversationId) {
    const { data, error } = await admin
      .from("conversations")
      .insert({
        user_id: user.id,
        title: body.message.slice(0, 80),
        space_ids: body.spaceIds ?? [],
      })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    conversationId = data.id;
  } else {
    // Verify ownership and pull prior messages.
    const { data: convo } = await admin
      .from("conversations")
      .select("user_id")
      .eq("id", conversationId)
      .maybeSingle();
    if (!convo || convo.user_id !== user.id) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const { data: prior } = await admin
      .from("messages")
      .select("role, content, created_at")
      .eq("conversation_id", conversationId)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: true });
    priorHistory = (prior ?? []).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content as string,
    }));
  }

  // Persist the new user message (after capturing prior history, so it's not in the replay).
  await admin.from("messages").insert({
    conversation_id: conversationId,
    role: "user",
    content: body.message,
  });

  // Build tool context: clamp the requested scope to spaces the user can access.
  const accessibleSpaces = await getAccessibleSpaces();
  const requestedIds = body.spaceIds ?? [];
  const scopedIds = requestedIds.length
    ? requestedIds.filter((id) => accessibleSpaces.some((s) => s.id === id))
    : accessibleSpaces.map((s) => s.id);
  const ctx: ToolContext = {
    userId: user.id,
    accessibleSpaceIds: scopedIds,
    spaceNameById: new Map(accessibleSpaces.map((s) => [s.id, s.name])),
    spaces: accessibleSpaces.map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
    })),
  };

  // Tell the model which workspaces are in scope (name + slug), so it can pass a
  // correct `space_id` to the tools — it never sees raw UUIDs otherwise, and
  // would guess the name and get an empty scope.
  const scopedSpaces = accessibleSpaces.filter((s) => scopedIds.includes(s.id));
  const workspaceListContext =
    scopedSpaces.length > 0
      ? `Workspaces you can search (pass the name or slug as space_id, or omit it to search all):\n${scopedSpaces
          .map((s) => `- ${s.name} (slug: ${s.slug})`)
          .join("\n")}`
      : "The user has no accessible workspaces.";

  // Resolve the "currently open" doc (chip in the chat footer) to title + path.
  // Only honor it when the doc lives in a space the user can access — never
  // leak metadata for docs outside their scope, even if a client posts an ID.
  let openDocContext: { id: string; title: string; path: string } | null = null;
  if (body.contextDocId) {
    const accessibleIds = accessibleSpaces.map((s) => s.id);
    if (accessibleIds.length > 0) {
      const { data: doc } = await admin
        .from("documents")
        .select("id, title, path, space_id")
        .eq("id", body.contextDocId)
        .in("space_id", accessibleIds)
        .is("deleted_at", null)
        .maybeSingle();
      if (doc) {
        openDocContext = {
          id: doc.id as string,
          title: doc.title as string,
          path: (doc.path as string) ?? "",
        };
      }
    }
  }

  const encoder = new TextEncoder();
  const sse = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown>) =>
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );

      // Source list aggregated across all search_documents calls so we can
      // emit a final `sources` event and persist them on the assistant row.
      const aggregatedSources = new Map<
        string,
        { n: number; documentId: string; chunkId: string; title: string; headingPath: string[] }
      >();

      // Conversation transcript fed to the model. We append assistant +
      // tool messages as we loop. Prior turns from the DB get replayed
      // (just user/assistant content — stored tool calls aren't persisted, but
      // the assistant text contains the answers it produced, which is enough
      // memory for follow-up references like "summarize each of those").
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: workspaceListContext },
        ...(openDocContext
          ? [
              {
                role: "system" as const,
                content: `<open_document id="${openDocContext.id}" title="${openDocContext.title.replace(/"/g, '\\"')}" path="${openDocContext.path.replace(/"/g, '\\"')}" />
The user is currently viewing this document in their reader. Treat references like "this", "this doc", "this article", "this page", or "the open doc" as referring to it. Call get_document with the id above if you need to read its content before answering.`,
              },
            ]
          : []),
        ...priorHistory.map(
          (m): OpenAI.Chat.ChatCompletionMessageParam => ({
            role: m.role,
            content: m.content,
          }),
        ),
        { role: "user", content: body.message },
      ];

      let finalAnswer = "";

      try {
        send("meta", { conversationId });
        send("status", {
          kind: "thinking",
          message: "Planning…",
        });

        for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
          const stream = await getOpenRouter().chat.completions.create({
            model,
            stream: true,
            tools: TOOL_SPECS,
            messages,
          });

          let assistantContent = "";
          // Tool call deltas arrive split across chunks, keyed by index.
          const toolCalls: Map<number, StreamedToolCall> = new Map();
          let finishReason: string | null = null;

          for await (const part of stream) {
            const choice = part.choices?.[0];
            if (!choice) continue;
            const delta = choice.delta;

            if (delta?.content) {
              assistantContent += delta.content;
              finalAnswer += delta.content;
              send("token", { delta: delta.content });
            }

            for (const tcd of delta?.tool_calls ?? []) {
              const idx = tcd.index ?? 0;
              const existing =
                toolCalls.get(idx) ??
                ({ id: "", name: "", argumentsRaw: "" } as StreamedToolCall);
              if (tcd.id) existing.id = tcd.id;
              if (tcd.function?.name) existing.name = tcd.function.name;
              if (tcd.function?.arguments)
                existing.argumentsRaw += tcd.function.arguments;
              toolCalls.set(idx, existing);
            }

            if (choice.finish_reason) finishReason = choice.finish_reason;
          }

          const calls = Array.from(toolCalls.values());

          if (calls.length === 0) {
            // No tools requested — the model has produced a final answer.
            break;
          }

          // Append the assistant turn (with its tool_calls) so we can attach
          // tool responses keyed by tool_call_id.
          messages.push({
            role: "assistant",
            content: assistantContent || null,
            tool_calls: calls.map((c) => ({
              id: c.id,
              type: "function" as const,
              function: { name: c.name, arguments: c.argumentsRaw || "{}" },
            })),
          });

          for (const call of calls) {
            let parsedArgs: unknown = null;
            try {
              parsedArgs = call.argumentsRaw ? JSON.parse(call.argumentsRaw) : {};
            } catch {
              parsedArgs = { _raw: call.argumentsRaw };
            }
            send("tool_call", {
              id: call.id,
              name: call.name,
              args: parsedArgs,
            });

            const result = await dispatchTool(call.name, call.argumentsRaw, ctx);

            // If this was a successful search, fold its sources into the
            // aggregated set so the UI can render them at the end.
            if (
              call.name === "search_documents" &&
              result.ok &&
              result.uiSources
            ) {
              for (const s of result.uiSources) {
                if (!aggregatedSources.has(s.chunkId)) {
                  aggregatedSources.set(s.chunkId, {
                    ...s,
                    n: aggregatedSources.size + 1,
                  });
                }
              }
              // Also tell the client immediately so source cards can stream in.
              send("sources", {
                sources: Array.from(aggregatedSources.values()),
              });
            }

            send("tool_result", {
              id: call.id,
              name: call.name,
              ok: result.ok,
              summary: result.ok ? result.summary : result.error,
            });

            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify(
                result.ok
                  ? { ok: true, data: result.data }
                  : { ok: false, error: result.error },
              ),
            });
          }

          send("status", { kind: "thinking", message: "Generating answer…" });

          if (finishReason && finishReason !== "tool_calls") {
            // Defensive: some providers set 'stop' even with tool calls. Loop again to be safe.
            continue;
          }
        }

        // Map citations actually emitted to their source records.
        const citations = parseCitations(finalAnswer)
          .map((c) => Array.from(aggregatedSources.values()).find((s) => s.n === c.n))
          .filter(Boolean);

        await admin.from("messages").insert({
          conversation_id: conversationId,
          role: "assistant",
          content: finalAnswer,
          model,
          citations,
        });

        await admin
          .from("chat_usage")
          .upsert(
            { user_id: user.id, day: today, count: (usage?.count ?? 0) + 1 },
            { onConflict: "user_id,day" },
          );

        send("done", {});
      } catch (err) {
        send("error", { message: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(sse, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
